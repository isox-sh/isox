import assert from 'node:assert/strict'
import { chmod, readFile, stat } from 'node:fs/promises'
import { delimiter, dirname, join } from 'node:path'

import { test, vi } from 'vitest'

import { fixture, github } from './fixture.mjs'

async function fakeGh(t, f, exitCode = 0) {
  const executable = join(f.root, '.isox/bin/gh')
  const output = join(f.root, '.isox/gh.json')

  await f.write('.isox/bin/gh', `#!/usr/bin/env node
const fs = require('node:fs')
const args = process.argv.slice(2)
const notesPath = args.find(value => value.startsWith('--notes-file=')).slice('--notes-file='.length)
fs.writeFileSync(${JSON.stringify(output)}, JSON.stringify({ args, notes: fs.readFileSync(notesPath, 'utf8'), notesPath, cwd: process.cwd() }))
process.exitCode = ${exitCode}
`)
  await chmod(executable, 0o755)
  vi.stubEnv('PATH', [dirname(executable), dirname(process.execPath), process.env.PATH].join(delimiter))
  t.onTestFinished(() => vi.unstubAllEnvs())

  return async () => JSON.parse(await readFile(output, 'utf8'))
}

test.skipIf(process.platform === 'win32')('GitHub release passes notes by file and verifies remote tag without shell expansion', async t => {
  const f = await fixture(t)
  const captured = await fakeGh(t, f)
  const notes = '## Release\n\nQuotes " \' and $(touch never) `touch never` stay literal.\n'
  const result = await github({
    tag: 'demo@1.0.0',
    notes,
    title: '-Release title',
    repository: 'owner/repo',
    draft: true,
    prerelease: true
  }, f.context)
  const output = await captured()

  assert.equal(result.success, true)
  assert.equal(output.notes, notes)
  assert.equal(output.cwd, f.root)
  assert.ok(output.args.includes('--verify-tag'))
  assert.ok(output.args.includes('--title=-Release title'))
  assert.ok(output.args.includes('--repo=owner/repo'))
  assert.ok(output.args.includes('--draft'))
  assert.ok(output.args.includes('--prerelease'))
  assert.deepEqual(output.args.slice(-2), ['--', 'demo@1.0.0'])
  await assert.rejects(stat(output.notesPath), { code: 'ENOENT' })
  await assert.rejects(stat(join(f.root, 'never')), { code: 'ENOENT' })
})

test.skipIf(process.platform === 'win32')('failed GitHub command reports failure and removes temporary notes', async t => {
  const f = await fixture(t)
  const captured = await fakeGh(t, f, 1)
  const result = await github({
    tag: 'demo@1.0.0',
    notes: 'notes'
  }, f.context)

  assert.equal(result.success, false)
  await assert.rejects(stat((await captured()).notesPath), { code: 'ENOENT' })
})

test('GitHub dry run avoids invoking gh and validates required options', async t => {
  const f = await fixture(t)

  assert.equal((await github({
    tag: 'demo@1.0.0',
    notes: 'notes',
    dryRun: true
  }, f.context)).success, true)

  for (const options of [{}, { tag: 'demo@1.0.0' }, {
    tag: '',
    notes: ''
  }, {
    tag: 'tag',
    notes: 'notes',
    draft: 'true'
  }, {
    tag: 'tag',
    notes: 'notes',
    unknown: true
  }]) {
    await assert.rejects(github(options, f.context), /Invalid semver:github options/)
  }

  await assert.rejects(github({
    tag: 'demo@1.0.0',
    notes: 'notes'
  }, {
    ...f.context,
    signal: AbortSignal.abort()
  }), { name: 'AbortError' })
})
