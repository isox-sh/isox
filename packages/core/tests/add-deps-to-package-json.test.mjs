import assert from 'node:assert/strict'
import { mkdir, mkdtemp, readdir, readFile, rm, symlink, writeFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { test } from 'vitest'

const require = createRequire(import.meta.url)
const { addDepsToPackageJson, createLogger } = require('../../../dist/core')

async function fixture(t) {
  const root = await mkdtemp(join(tmpdir(), 'isox-deps-'))
  t.onTestFinished(() => rm(root, { recursive: true, force: true }))
  const projectRoot = join(root, 'project')
  await mkdir(projectRoot)
  const entries = []
  const logger = createLogger({ reporters: [{ log: entry => entries.push(entry) }] })
  const file = join(projectRoot, 'package.json')
  return { root, projectRoot, logger, entries, file }
}

test('adds runtime and development dependencies while preserving metadata, existing versions, and sections', async t => {
  const context = await fixture(t)
  const original = {
    name: 'demo', scripts: { build: 'custom' }, private: true,
    dependencies: { existing: 'workspace:*', zulu: '^2.0.0' },
    devDependencies: { tool: '~3.0.0' }, peerDependencies: { peer: '^4' },
  }
  await writeFile(context.file, JSON.stringify(original))
  await addDepsToPackageJson({
    dependencies: { alpha: '^1', tool: '^99', existing: '^99' },
    devDependencies: { '@isox-sh/nx': '0.0.1', zulu: '^99' },
  }, context)
  assert.deepEqual(JSON.parse(await readFile(context.file, 'utf8')), {
    ...original,
    dependencies: { alpha: '^1', existing: 'workspace:*', zulu: '^2.0.0' },
    devDependencies: { '@isox-sh/nx': '0.0.1', tool: '~3.0.0' },
  })
  assert.deepEqual(Object.keys(JSON.parse(await readFile(context.file, 'utf8')).dependencies), ['alpha', 'existing', 'zulu'])
  assert.deepEqual(context.entries.map(entry => entry.args), [['Updated file package.json']])
})

test('creates a missing manifest and leaves empty requests untouched', async t => {
  const context = await fixture(t)
  await addDepsToPackageJson({}, context)
  assert.deepEqual(await readdir(context.projectRoot), [])
  await addDepsToPackageJson({ devDependencies: { '@isox-sh/nx': '0.0.1' } }, context)
  assert.deepEqual(JSON.parse(await readFile(context.file, 'utf8')), { devDependencies: { '@isox-sh/nx': '0.0.1' } })
})

test('repeated additions preserve exact contents and do not log another write', async t => {
  const context = await fixture(t)
  const source = '{ "devDependencies": { "@isox-sh/nx": "workspace:*" }, "custom": true }\n'
  await writeFile(context.file, source)
  await addDepsToPackageJson({ devDependencies: { '@isox-sh/nx': '0.0.1' } }, context)
  assert.equal(await readFile(context.file, 'utf8'), source)
  assert.deepEqual(context.entries, [])
})

test('rejects malformed manifests and dependency maps without changing their contents', async t => {
  const context = await fixture(t)
  for (const source of ['{broken', 'null', '[]', '{"dependencies":[]}', '{"devDependencies":{"bad":42}}']) {
    await writeFile(context.file, source)
    await assert.rejects(addDepsToPackageJson({ devDependencies: { tool: '^1' } }, context), /Invalid/)
    assert.equal(await readFile(context.file, 'utf8'), source)
  }
  assert.deepEqual(context.entries, [])
})

test('rejects invalid additions and duplicate section requests before writing', async t => {
  const context = await fixture(t)
  for (const deps of [
    { dependencies: null }, { dependencies: [] }, { dependencies: { bad: 42 } },
    { dependencies: { 'Bad Name': '^1' } }, { dependencies: { '@scope/../bad': '^1' } },
    { devDependencies: { bad: '' } }, { dependencies: { '': '^1' } },
    { dependencies: { tool: '^1' }, devDependencies: { tool: '^2' } },
  ]) {
    await assert.rejects(addDepsToPackageJson(deps, context), /Invalid|cannot be added to both/)
  }
  assert.deepEqual(await readdir(context.projectRoot), [])
})

test('rejects a package.json symlink without modifying files outside the project', async t => {
  const context = await fixture(t)
  const outside = join(context.root, 'outside.json')
  await writeFile(outside, '{}')
  await symlink(outside, context.file)
  await assert.rejects(addDepsToPackageJson({ dependencies: { tool: '^1' } }, context), /symlink/)
  assert.equal(await readFile(outside, 'utf8'), '{}')
})
