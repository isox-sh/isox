import assert from 'node:assert/strict'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'

import { test } from 'vitest'

const require = createRequire(import.meta.url)
const { createLogger, LogLevels, runExecutor } = require('../../../dist/core')

async function fixture(t, source) {
  const root = await mkdtemp(join(tmpdir(), 'isox lifecycle '))
  t.onTestFinished(() => rm(root, { recursive: true, force: true }))
  const write = async (file, value) => {
    const path = join(root, file)
    await mkdir(dirname(path), { recursive: true })
    await writeFile(path, typeof value === 'string' ? value : JSON.stringify(value))
  }
  await write('isox.json', {})
  await write('node_modules/@fixture/plugin/package.json', { executors: './executors.json' })
  await write('node_modules/@fixture/plugin/executors.json', { executors: { build: { implementation: './build.cjs' } } })
  await write('node_modules/@fixture/plugin/build.cjs', source)
  const workspace = { projects: { demo: { name: 'demo', root: '.', executors: { build: { executor: '@fixture/plugin:build' } } } } }
  const logs = []
  const logger = createLogger({ level: LogLevels.debug, reporters: [{ log: entry => logs.push(entry) }] })
  return { root, workspace, logs, logger }
}

test('continuous builds can fail and recover without final completion logging', async t => {
  const { root, workspace, logs, logger } = await fixture(t, `module.exports = async function* () {
    yield { success: false, continuous: true }
    yield { success: true, continuous: true }
  }`)
  await runExecutor(workspace, 'demo', 'build', root, logger)
  assert.equal(logs.filter(entry => entry.type === 'error').length, 1)
  assert.ok(logs.some(entry => entry.type === 'success' && entry.args[0].includes('Watching for changes')))
  assert.ok(logs.every(entry => !entry.args[0].includes('Successfully completed')))
})

test('passes cancellation to native executors and closes the stream', async t => {
  const { root, workspace, logger } = await fixture(t, `module.exports = async function* (_, context) {
    try {
      if (!context.signal.aborted) await new Promise(resolve => context.signal.addEventListener('abort', resolve, { once: true }))
    } finally { require('node:fs').writeFileSync(require('node:path').join(context.workspaceRoot, 'closed'), 'yes') }
  }`)
  const controller = new AbortController()
  const running = runExecutor(workspace, 'demo', 'build', root, logger, undefined, controller.signal)
  controller.abort()
  await running
  assert.equal(await readFile(join(root, 'closed'), 'utf8'), 'yes')
})

test('ordinary failed streams still stop and run iterator cleanup', async t => {
  const { root, workspace, logger } = await fixture(t, `module.exports = async function* (_, context) {
    try { yield { success: false } }
    finally { require('node:fs').writeFileSync(require('node:path').join(context.workspaceRoot, 'closed'), 'yes') }
  }`)
  await assert.rejects(runExecutor(workspace, 'demo', 'build', root, logger), /Task failed for demo/)
  assert.equal(await readFile(join(root, 'closed'), 'utf8'), 'yes')
})

test('cancelled streams close without reporting a task failure or completion', async t => {
  const { root, workspace, logger, logs } = await fixture(t, `module.exports = async function* (_, context) {
    try {
      if (!context.signal.aborted) await new Promise(resolve => context.signal.addEventListener('abort', resolve, { once: true }))
      yield { success: false }
      throw new Error('A cancelled stream must not be resumed')
    } finally { require('node:fs').writeFileSync(require('node:path').join(context.workspaceRoot, 'closed'), 'yes') }
  }`)
  const controller = new AbortController()
  const running = runExecutor(workspace, 'demo', 'build', root, logger, undefined, controller.signal)
  controller.abort()
  await running
  assert.equal(await readFile(join(root, 'closed'), 'utf8'), 'yes')
  assert.ok(logs.every(entry => entry.type !== 'error' && entry.type !== 'success'))
})

for (const iterable of [false, true]) {
  for (const api of ['timer', 'throwIfAborted']) {
    test(`cancelled ${iterable ? 'streams' : 'promises'} accept ${api} cancellation and finish cleanup`, async t => {
      const { root, workspace, logger, logs } = await fixture(t, `module.exports = async function${iterable ? '*' : ''} (_, context) {
        try {
          ${api === 'timer'
            ? "await require('node:timers/promises').setTimeout(60_000, undefined, { signal: context.signal })"
            : 'context.signal.throwIfAborted()'}
          ${iterable ? 'yield' : 'return'} { success: true }
        } finally { require('node:fs').writeFileSync(require('node:path').join(context.workspaceRoot, 'closed'), 'yes') }
      }`)
      const controller = new AbortController()
      controller.abort(new Error('Stopped by caller'))
      await runExecutor(workspace, 'demo', 'build', root, logger, undefined, controller.signal)
      assert.equal(await readFile(join(root, 'closed'), 'utf8'), 'yes')
      assert.ok(logs.every(entry => entry.type !== 'error' && entry.type !== 'success'))
    })
  }
}

test('cancellation does not suppress an unrelated executor failure', async t => {
  const { root, workspace, logger } = await fixture(t, `module.exports = async () => {
    throw new Error('Cleanup failed')
  }`)
  const controller = new AbortController()
  controller.abort()
  await assert.rejects(runExecutor(workspace, 'demo', 'build', root, logger, undefined, controller.signal), /Cleanup failed/)
})

test('an AbortError still fails the task when its signal has not been cancelled', async t => {
  const { root, workspace, logger } = await fixture(t, `module.exports = async () => {
    throw new DOMException('Independent operation aborted', 'AbortError')
  }`)
  await assert.rejects(runExecutor(workspace, 'demo', 'build', root, logger, undefined, new AbortController().signal), /Independent operation aborted/)
})

test('native child processes are terminated on cancellation even when they ignore SIGTERM', async t => {
  const { root } = await fixture(t, 'module.exports = () => ({ success: true })')
  const { runProcess } = require('../../../dist/core')
  await writeFile(join(root, 'child.cjs'), `
    require('node:fs').writeFileSync('ready', String(process.pid))
    process.on('SIGTERM', () => {})
    setInterval(() => {}, 100)
  `)
  const controller = new AbortController()
  t.onTestFinished(() => controller.abort())
  const running = runProcess(process.execPath, ['child.cjs'], { cwd: root, signal: controller.signal })
  const deadline = Date.now() + 5_000
  let pid
  while (!pid && Date.now() < deadline) {
    try {
      pid = Number(await readFile(join(root, 'ready'), 'utf8'))
    } catch {
      await new Promise(resolve => setTimeout(resolve, 20))
    }
  }
  assert.ok(pid, 'child did not start')
  controller.abort()
  assert.deepEqual(await running, { success: false })
  assert.throws(() => process.kill(pid, 0), { code: 'ESRCH' })
})
