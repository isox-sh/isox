import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { once } from 'node:events'
import { mkdir, rm, symlink } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { setTimeout as delay } from 'node:timers/promises'

import { test } from 'vitest'

import { fixture, tsc } from './fixture.mjs'

async function next(iterator) {
  let timeout
  try {
    return await Promise.race([iterator.next(), new Promise((_, reject) => {
      timeout = setTimeout(() => reject(new Error('Timed out waiting for a watch build')), 10_000)
    })])
  } finally {
    clearTimeout(timeout)
  }
}

test('watch recovers from compiler errors and updates assets, metadata, deletions, and extended config', async t => {
  const { projectRoot, config, write, read, context } = await fixture(t)
  await write('base.json', config)
  await write('tsconfig.json', { extends: './base.json' })
  await write('src/deleted.ts', 'export const unused = true')
  await write('assets/file.txt', 'first')
  await write('package.json', { name: '@fixture/watch', version: '1.0.0', main: './dist/index.js' })
  const controller = new AbortController()
  const stream = await tsc({
    watch: true, pollInterval: 100, generatePackageJson: true, assets: [
      { input: 'packages/demo package/assets', glob: '**/*', output: 'assets' },
    ]
  }, { ...context, signal: controller.signal })
  const iterator = stream[Symbol.asyncIterator]()
  t.onTestFinished(async () => {
    controller.abort(); await iterator.return()
  })
  assert.deepEqual((await next(iterator)).value, { success: true, continuous: true })
  const original = await read('dist/index.js')
  await write('src/index.ts', 'export const answer: number = "broken"')
  assert.deepEqual((await next(iterator)).value, { success: false, continuous: true })
  assert.equal(await read('dist/index.js'), original)
  await write('src/index.ts', 'export const answer: number = 43')
  await write('assets/file.txt', 'updated')
  await write('package.json', { name: '@fixture/watch', version: '2.0.0', main: './dist/index.js' })
  assert.equal((await next(iterator)).value.success, true)
  assert.match(await read('dist/index.js'), /43/)
  assert.equal(await read('dist/assets/file.txt'), 'updated')
  assert.equal(JSON.parse(await read('dist/package.json')).version, '2.0.0')
  await rm(join(projectRoot, 'src/deleted.ts'))
  await rm(join(projectRoot, 'assets/file.txt'))
  assert.equal((await next(iterator)).value.success, true)
  await assert.rejects(read('dist/deleted.js'), { code: 'ENOENT' })
  await assert.rejects(read('dist/assets/file.txt'), { code: 'ENOENT' })
  config.compilerOptions.declarationDir = 'declarations'
  await write('base.json', config)
  assert.equal((await next(iterator)).value.success, true)
  assert.match(await read('declarations/index.d.ts'), /answer/)
  // Cancelling while next() is pending must release the polling timer and iterator.
  const pending = iterator.next()
  controller.abort()
  assert.equal((await pending).done, true)
})

test('iterator return cancels a pending poll without requiring an external signal', async t => {
  const { context } = await fixture(t)
  const stream = await tsc({ watch: true, pollInterval: 100 }, context)
  const iterator = stream[Symbol.asyncIterator]()
  t.onTestFinished(() => iterator.return())
  assert.equal((await next(iterator)).value.success, true)
  const pending = iterator.next()
  await iterator.return()
  assert.equal((await pending).done, true)
})

for (const signal of ['SIGINT', 'SIGTERM']) {
  test(`CLI watch handles ${signal} without orphaning its compiler or reporting final completion`, async t => {
    const { root, projectRoot, write } = await fixture(t)
    await write('../../isox.json', {})
    await write('project.json', { name: 'demo', executors: { build: { executor: 'js:tsc', options: { watch: true, pollInterval: 100 } } } })
    const link = join(root, 'node_modules/@isox-sh/js')
    await mkdir(join(root, 'node_modules/@isox-sh'), { recursive: true })
    await symlink(resolve(import.meta.dirname, '../../../dist/js'), link, process.platform === 'win32' ? 'junction' : 'dir')
    const child = spawn(process.execPath, [resolve(import.meta.dirname, '../../../dist/cli/index.js'), 'build', 'demo'], {
      cwd: projectRoot, stdio: ['ignore', 'pipe', 'pipe'],
    })
    let stdout = ''
    let stderr = ''
    child.stdout.on('data', chunk => {
      stdout += chunk
    })
    child.stderr.on('data', chunk => {
      stderr += chunk
    })
    t.onTestFinished(() => {
      if (child.exitCode === null) {
        child.kill('SIGKILL')
      }
    })
    const deadline = Date.now() + 10_000
    while (!stdout.includes('Watching for changes') && Date.now() < deadline && child.exitCode === null) {
      await delay(25)
    }
    assert.match(stdout, /Watching for changes/, stderr)
    const exited = once(child, 'exit')
    child.kill(signal)
    const [code] = await Promise.race([exited, delay(5_000).then(() => {
      throw new Error('Watch process did not stop')
    })])
    assert.equal(code, signal === 'SIGINT' ? 130 : 143)
    assert.doesNotMatch(stdout, /Successfully completed/)
  })
}

test('cancels an active native compiler process and rejects process launch failures', async t => {
  const { projectRoot, context } = await fixture(t)
  const { createRequire } = await import('node:module')
  const require = createRequire(import.meta.url)
  const { invokeCompiler } = require('../../../dist/js/executors/tsc/compiler')
  const controller = new AbortController()
  const running = invokeCompiler(['--project', join(projectRoot, 'tsconfig.json'), '--watch', '--pretty', 'false'], context.workspaceRoot, controller.signal)
  t.onTestFinished(() => controller.abort())
  let finished = false
  running.then(() => {
    finished = true
  })
  await delay(150)
  assert.equal(finished, false)
  controller.abort()
  const result = await running
  assert.equal(result.success, false)
  await assert.rejects(invokeCompiler(['--version'], join(projectRoot, 'missing')), { code: 'ENOENT' })
})
