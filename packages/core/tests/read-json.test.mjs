import assert from 'node:assert/strict'
import { mkdir, mkdtemp, readdir, rm, symlink, writeFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { test } from 'vitest'

const require = createRequire(import.meta.url)
const { createLogger, readJson, writeJson } = require('../dist')

async function fixture(t) {
  const workspaceRoot = await mkdtemp(join(tmpdir(), 'isox-read-json-'))
  t.onTestFinished(() => rm(workspaceRoot, { recursive: true, force: true }))
  const projectRoot = join(workspaceRoot, 'project')
  await mkdir(projectRoot)
  const entries = []
  const logger = createLogger({ reporters: [{ log: entry => entries.push(entry) }] })
  return { workspaceRoot, projectRoot, logger, entries }
}

test('reads nested JSON written by writeJson using relative and absolute paths without logging', async t => {
  const context = await fixture(t)
  const value = { enabled: true, values: [1, null, 'hello'] }
  await writeJson('config/settings.json', value, context)
  context.entries.length = 0
  assert.deepEqual(await readJson('config/settings.json', context), value)
  assert.deepEqual(await readJson(join(context.projectRoot, 'config/settings.json'), context), value)
  assert.deepEqual(context.entries, [])
})

test('accepts all JSON values and UTF-8 byte order marks', async t => {
  const context = await fixture(t)
  for (const value of [null, false, 0, 'hello', [], {}]) {
    await writeFile(join(context.projectRoot, 'value.json'), `\uFEFF${JSON.stringify(value)}\n`)
    assert.deepEqual(await readJson('value.json', context), value)
  }
})

test('reports malformed JSON with its filename and original parse error', async t => {
  const context = await fixture(t)
  for (const source of ['', '{broken', '{"enabled":true,}', '// comment\n{}']) {
    await writeFile(join(context.projectRoot, 'broken.json'), source)
    await assert.rejects(readJson('broken.json', context), error => {
      assert.ok(error instanceof SyntaxError)
      assert.match(error.message, /Invalid JSON in broken\.json/)
      assert.ok(error.cause instanceof SyntaxError)
      return true
    })
  }
})

test('preserves missing-file errors without creating directories', async t => {
  const context = await fixture(t)
  await assert.rejects(readJson('nested/missing.json', context), { code: 'ENOENT' })
  assert.deepEqual(await readdir(context.projectRoot), [])
})

test('rejects traversal, absolute outside paths, sibling prefixes, and the project root', async t => {
  const context = await fixture(t)
  for (const file of ['../outside.json', '../project-other/file.json', join(context.workspaceRoot, 'outside.json'), '.', '']) {
    await assert.rejects(readJson(file, context), /must be inside the project/)
  }
})

test('rejects file and directory symlinks, including dangling links', async t => {
  const context = await fixture(t)
  const outside = join(context.workspaceRoot, 'outside')
  await mkdir(outside)
  await writeFile(join(outside, 'value.json'), '{}')
  await symlink(outside, join(context.projectRoot, 'linked'), 'junction')
  await symlink(join(outside, 'value.json'), join(context.projectRoot, 'linked.json'))
  await symlink(join(outside, 'missing.json'), join(context.projectRoot, 'dangling.json'))
  for (const file of ['linked/value.json', 'linked.json', 'dangling.json']) {
    await assert.rejects(readJson(file, context), /Cannot read JSON through a symlink/)
  }
})

test('supports a project root reached through a symlink', async t => {
  const context = await fixture(t)
  await writeFile(join(context.projectRoot, 'value.json'), '{"enabled":true}')
  const projectRoot = join(context.workspaceRoot, 'project-alias')
  await symlink(context.projectRoot, projectRoot, 'junction')
  assert.deepEqual(await readJson('value.json', { projectRoot }), { enabled: true })
})
