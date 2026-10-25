import assert from 'node:assert/strict'
import { link, mkdir, mkdtemp, readdir, readFile, rm, symlink, writeFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { test } from 'vitest'

const require = createRequire(import.meta.url)
const { createLogger, writeJson } = require('../dist')

async function fixture(t) {
  const workspaceRoot = await mkdtemp(join(tmpdir(), 'isox-write-json-'))
  t.onTestFinished(() => rm(workspaceRoot, { recursive: true, force: true }))
  const projectRoot = join(workspaceRoot, 'packages/demo')
  await mkdir(projectRoot, { recursive: true })
  const entries = []
  const logger = createLogger({ reporters: [{ log: entry => entries.push(entry) }] })
  return { workspaceRoot, projectRoot, logger, entries }
}

test('writes formatted JSON in nested project directories and logs creation with the workspace-relative path', async t => {
  const context = await fixture(t)
  await writeJson('config/settings.json', { enabled: true }, context)
  assert.equal(await readFile(join(context.projectRoot, 'config/settings.json'), 'utf8'), '{\n  "enabled": true\n}\n')
  assert.deepEqual(context.entries.map(({ type, args }) => ({ type, args })), [
    { type: 'success', args: ['Created file packages/demo/config/settings.json'] },
  ])
  assert.deepEqual(await readdir(join(context.projectRoot, 'config')), ['settings.json'])
})

test('accepts absolute paths within the project and logs relative to the project without a workspace', async t => {
  const { projectRoot, logger, entries } = await fixture(t)
  await writeJson(join(projectRoot, 'project.json'), { name: 'demo' }, { projectRoot, logger })
  assert.deepEqual(entries[0].args, ['Created file project.json'])
})

test('rejects traversal, sibling prefixes, absolute outside paths, and the project root', async t => {
  const context = await fixture(t)
  for (const path of ['../outside.json', '../demo-other/file.json', join(context.workspaceRoot, 'outside.json'), '.', '']) {
    await assert.rejects(writeJson(path, {}, context), /must be inside the project/)
  }
  assert.deepEqual(await readdir(context.projectRoot), [])
  assert.deepEqual(await readdir(context.workspaceRoot), ['packages'])
  assert.deepEqual(context.entries, [])
})

test('rejects directory and file symlinks without writing outside the project', async t => {
  const context = await fixture(t)
  const outside = join(context.workspaceRoot, 'outside')
  await mkdir(outside)
  await writeFile(join(outside, 'existing.json'), 'original')
  await symlink(outside, join(context.projectRoot, 'linked'), 'junction')
  await symlink(join(outside, 'existing.json'), join(context.projectRoot, 'linked.json'))
  await symlink(join(outside, 'missing.json'), join(context.projectRoot, 'dangling.json'))
  for (const path of ['linked/nested/file.json', 'linked.json', 'dangling.json']) {
    await assert.rejects(writeJson(path, {}, context), /symlink/)
  }
  assert.deepEqual(await readdir(outside), ['existing.json'])
  assert.equal(await readFile(join(outside, 'existing.json'), 'utf8'), 'original')
  assert.deepEqual(context.entries, [])
})

test('replaces existing files without modifying hard-linked files outside the project', async t => {
  const context = await fixture(t)
  const outside = join(context.workspaceRoot, 'outside.json')
  const destination = join(context.projectRoot, 'settings.json')
  await writeFile(outside, 'original')
  await link(outside, destination)
  await writeJson('settings.json', { updated: true }, context)
  assert.equal(await readFile(outside, 'utf8'), 'original')
  assert.deepEqual(JSON.parse(await readFile(destination, 'utf8')), { updated: true })
  assert.deepEqual(context.entries[0].args, ['Updated file packages/demo/settings.json'])
})

test('exclusive writes preserve existing files, clean up temporary files, and only log successful writes', async t => {
  const context = await fixture(t)
  await writeJson('project.json', { original: true }, context, { overwrite: false })
  await assert.rejects(writeJson('project.json', {}, context, { overwrite: false }), { code: 'EEXIST' })
  assert.deepEqual(JSON.parse(await readFile(join(context.projectRoot, 'project.json'), 'utf8')), { original: true })
  assert.deepEqual(await readdir(context.projectRoot), ['project.json'])
  assert.equal(context.entries.length, 1)
})

test('serialization failures do not create directories or log success', async t => {
  const context = await fixture(t)
  const circular = {}
  circular.self = circular
  for (const value of [undefined, 1n, circular]) {
    await assert.rejects(writeJson('nested/file.json', value, context), TypeError)
  }
  assert.deepEqual(await readdir(context.projectRoot), [])
  assert.deepEqual(context.entries, [])
})
