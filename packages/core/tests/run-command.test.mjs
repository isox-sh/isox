import { createRequire } from 'node:module'

import { test } from 'vitest'

const require = createRequire(import.meta.url)
const assert = require('node:assert/strict')
const { mkdtemp, mkdir, readFile, realpath, rm, writeFile } = require('node:fs/promises')
const { tmpdir } = require('node:os')
const { join } = require('node:path')
const { Ajv } = require('ajv')
const { default: runCommand } = require('../../../dist/core/executors/run-command/run-command.executor')
const commandSchema = require('../../../dist/core/executors/run-command/run-command.schema.json')

test('command schema rejects blank commands consistently with the executor', async () => {
  const validate = new Ajv().compile(commandSchema)

  for (const command of ['', '   ', '\t\r\n', '\u00a0\u2003\ufeff']) {
    assert.equal(validate({ command }), false, `Accepted blank command: ${JSON.stringify(command)}`)
    await assert.rejects(runCommand({ command }, { workspaceRoot: process.cwd() }), /non-empty command/)
  }

  for (const command of ['node --version', '  node --version  ', '\nnode --version\n']) {
    assert.equal(validate({ command }), true, `Rejected command: ${JSON.stringify(command)}`)
  }
})

test('command executor uses the workspace root and supports relative working directories', async (t) => {
  const root = await mkdtemp(join(tmpdir(), 'isox command-'))

  t.onTestFinished(() => rm(root, {
    recursive: true,
    force: true
  }))
  await mkdir(join(root, 'nested'))
  for (const cwd of [undefined, 'nested']) {
    const directory = cwd ? join(root, cwd) : root

    await writeFile(join(directory, 'task.cjs'), `
      require('node:fs').writeFileSync('result.txt', process.cwd())
    `)
    const result = await runCommand({
      command: 'node task.cjs',
      cwd
    }, { workspaceRoot: root })

    assert.deepEqual(result, { success: true })
    assert.equal(await readFile(join(directory, 'result.txt'), 'utf8'), await realpath(directory))
  }
})

test('command executor returns failure for nonzero exits', async () => {
  const result = await runCommand({ command: 'node -e "process.exit(7)"' }, { workspaceRoot: process.cwd() })

  assert.deepEqual(result, { success: false })
})

test('command executor rejects spawn failures', async (t) => {
  const root = await mkdtemp(join(tmpdir(), 'isox-command-'))

  t.onTestFinished(() => rm(root, {
    recursive: true,
    force: true
  }))
  await assert.rejects(
    runCommand({
      command: 'node --version',
      cwd: 'missing'
    }, { workspaceRoot: root }),
    { code: 'ENOENT' },
  )
})

test('command executor validates options before execution', async () => {
  for (const command of [undefined, '', '   ', 42]) {
    await assert.rejects(runCommand({ command }, { workspaceRoot: process.cwd() }), /non-empty command/)
  }

  await assert.rejects(
    runCommand({
      command: 'node --version',
      cwd: 42
    }, { workspaceRoot: process.cwd() }),
    /cwd must be a string/,
  )
})

async function commandsFixture(t) {
  const root = await mkdtemp(join(tmpdir(), 'isox-commands-'))

  t.onTestFinished(() => rm(root, {
    recursive: true,
    force: true
  }))
  await mkdir(join(root, 'nested'))
  await writeFile(join(root, 'nested/task.cjs'), `
    const fs = require('node:fs')
    const name = process.argv[2]
    fs.appendFileSync('events', name + '\\n')
    if (name === 'fail') process.exit(7)
  `)

  return root
}

test('commands run in order with parallel false, sharing cwd and accepting command objects', async t => {
  const root = await commandsFixture(t)
  const result = await runCommand({
    commands: ['node task.cjs first', { command: 'node task.cjs second' }],
    parallel: false,
    cwd: 'nested'
  }, { workspaceRoot: root })

  assert.deepEqual(result, { success: true })
  assert.equal(await readFile(join(root, 'nested/events'), 'utf8'), 'first\nsecond\n')
})

test('sequential commands stop on the first failure', async t => {
  const root = await commandsFixture(t)
  const result = await runCommand({
    commands: ['node task.cjs first', 'node task.cjs fail', 'node task.cjs skipped'],
    parallel: false,
    cwd: 'nested'
  }, { workspaceRoot: root })

  assert.deepEqual(result, { success: false })
  assert.equal(await readFile(join(root, 'nested/events'), 'utf8'), 'first\nfail\n')
})

test('commands default to parallel execution and await every successful command', async t => {
  const root = await commandsFixture(t)

  await writeFile(join(root, 'barrier.cjs'), `
    const fs = require('node:fs')
    const [name, peer] = process.argv.slice(2)
    fs.writeFileSync(name, '')
    const timeout = setTimeout(() => process.exit(9), 5000)
    const interval = setInterval(() => {
      if (!fs.existsSync(peer)) return
      clearInterval(interval)
      clearTimeout(timeout)
      setTimeout(() => fs.writeFileSync(name + '-done', ''), name === 'one' ? 10 : 100)
    }, 10)
  `)
  const result = await runCommand({
    commands: ['node barrier.cjs one two', { command: 'node barrier.cjs two one' }]
  }, { workspaceRoot: root })

  assert.deepEqual(result, { success: true })
  await readFile(join(root, 'one-done'))
  await readFile(join(root, 'two-done'))
})

test('invalid arrays and parallel settings fail validation before any command runs', async t => {
  const root = await commandsFixture(t)
  const validate = new Ajv().compile(commandSchema)
  const command = 'node task.cjs should-not-run'

  for (const options of [
    { commands: [] },
    { commands: 'node --version' },
    {
      command,
      commands: [command]
    },
    { commands: [command, '  '] },
    { commands: [command, null] },
    { commands: [command, 42] },
    { commands: [command, {}] },
    { commands: [command, { command: '' }] },
    {
      commands: [command],
      parallel: 'false'
    },
  ]) {
    assert.equal(validate(options), false, JSON.stringify(options))
    await assert.rejects(runCommand({
      ...options,
      cwd: 'nested'
    }, { workspaceRoot: root }), /run-command/)
  }

  await assert.rejects(readFile(join(root, 'nested/events')), { code: 'ENOENT' })
  assert.equal(validate({
    commands: [command, { command }],
    parallel: false
  }), true)
})

for (const cancellation of ['failure', 'abort']) {
  test(`parallel ${cancellation} cancels other commands`, async t => {
    const root = await commandsFixture(t)
    const controller = new AbortController()

    await writeFile(join(root, 'watch.cjs'), `
      const fs = require('node:fs')
      setInterval(() => {}, 100)
      process.on('SIGTERM', () => { fs.writeFileSync('stopped', ''); process.exit(0) })
      fs.writeFileSync('ready', '')
    `)
    await writeFile(join(root, 'fail.cjs'), `
      const fs = require('node:fs')
      const timeout = setTimeout(() => process.exit(9), 5000)
      setInterval(() => { if (fs.existsSync('ready')) process.exit(7) }, 10)
    `)
    const running = runCommand({
      commands: ['node watch.cjs', cancellation === 'failure' ? 'node fail.cjs' : 'node watch.cjs']
    }, {
      workspaceRoot: root,
      signal: controller.signal
    })

    try {
      if (cancellation === 'abort') {
        for (let attempt = 0; ; attempt++) {
          try {
            await readFile(join(root, 'ready'))
            break
          } catch (error) {
            if (error.code !== 'ENOENT' || attempt === 500) {
              throw error
            }

            await new Promise(resolve => setTimeout(resolve, 10))
          }
        }

        controller.abort()
      }

      assert.deepEqual(await running, { success: false })
      if (process.platform !== 'win32') {
        await readFile(join(root, 'stopped'))
      }
    } finally {
      controller.abort()
      await running
    }
  })
}

test('parallel spawn failures reject after cleaning up all commands', async t => {
  const root = await commandsFixture(t)

  await assert.rejects(runCommand({
    commands: ['node --version', 'node --version'],
    cwd: 'missing'
  }, { workspaceRoot: root }), { code: 'ENOENT' })
})

test('parallel failure waits for an uncooperative sibling descendant to stop', { skip: process.platform === 'win32' }, async t => {
  const root = await commandsFixture(t)
  await writeFile(join(root, 'launcher.cjs'), `
    require('node:child_process').spawn(process.execPath, ['descendant.cjs'], { stdio: 'ignore' })
    setInterval(() => {}, 100)
  `)
  await writeFile(join(root, 'descendant.cjs'), `
    const fs = require('node:fs')
    process.on('SIGTERM', () => {})
    fs.writeFileSync('heartbeat', 'ready')
    setInterval(() => fs.writeFileSync('heartbeat', String(Date.now())), 20)
  `)
  await writeFile(join(root, 'fail.cjs'), `
    const fs = require('node:fs')
    setTimeout(() => process.exit(9), 5000)
    setInterval(() => { if (fs.existsSync('heartbeat')) process.exit(7) }, 10)
  `)
  assert.deepEqual(await runCommand({ commands: ['node launcher.cjs', 'node fail.cjs'] }, { workspaceRoot: root }), { success: false })
  const stopped = await readFile(join(root, 'heartbeat'), 'utf8')
  await new Promise(resolve => setTimeout(resolve, 150))
  assert.equal(await readFile(join(root, 'heartbeat'), 'utf8'), stopped)
})
