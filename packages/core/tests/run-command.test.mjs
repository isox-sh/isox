import { createRequire } from 'node:module'

import { test } from 'vitest'

const require = createRequire(import.meta.url)
const assert = require('node:assert/strict')
const { mkdtemp, mkdir, readFile, realpath, rm, writeFile } = require('node:fs/promises')
const { tmpdir } = require('node:os')
const { join } = require('node:path')
const { Ajv } = require('ajv')
const { default: runCommand } = require('../dist/commands/run-command/run-command.command')
const commandSchema = require('../schemas/run-command.json')

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
  t.onTestFinished(() => rm(root, { recursive: true, force: true }))
  await mkdir(join(root, 'nested'))
  for (const cwd of [undefined, 'nested']) {
    const directory = cwd ? join(root, cwd) : root
    await writeFile(join(directory, 'task.cjs'), `
      require('node:fs').writeFileSync('result.txt', process.cwd())
    `)
    const result = await runCommand({ command: 'node task.cjs', cwd }, { workspaceRoot: root })
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
  t.onTestFinished(() => rm(root, { recursive: true, force: true }))
  await assert.rejects(
    runCommand({ command: 'node --version', cwd: 'missing' }, { workspaceRoot: root }),
    { code: 'ENOENT' },
  )
})

test('command executor validates options before execution', async () => {
  for (const command of [undefined, '', '   ', 42]) {
    await assert.rejects(runCommand({ command }, { workspaceRoot: process.cwd() }), /non-empty command/)
  }
  await assert.rejects(
    runCommand({ command: 'node --version', cwd: 42 }, { workspaceRoot: process.cwd() }),
    /cwd must be a string/,
  )
})
