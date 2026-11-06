import assert from 'node:assert/strict'
import { mkdir, mkdtemp, readFile, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'

import { test } from 'vitest'

import { planMigrations, runMigrations } from '../../../dist/core/migration/index.js'

const dist = resolve(import.meta.dirname, '../../../dist')

async function fixture(t, settings) {
  const root = await mkdtemp(join(tmpdir(), 'isox-named-inputs-'))
  t.onTestFinished(() => rm(root, {
    recursive: true,
    force: true
  }))
  const packageRoot = join(root, 'node_modules/@isox-sh/cli')
  await mkdir(join(packageRoot, 'migrations'), { recursive: true })
  await symlink(join(dist, 'core'), join(root, 'node_modules/@isox-sh/core'), 'junction')
  const manifest = JSON.parse(await readFile(join(dist, 'cli/package.json'), 'utf8'))
  const registry = JSON.parse(await readFile(join(dist, 'cli', manifest.migrations), 'utf8'))
  const entry = registry.migrations['add-named-inputs']
  // Simulate installing the release containing the migration, using its real build artifacts.
  await writeFile(join(packageRoot, 'package.json'), JSON.stringify({
    ...manifest,
    version: entry.version
  }))
  await writeFile(join(packageRoot, 'migrations.json'), JSON.stringify(registry))
  await writeFile(join(packageRoot, entry.implementation), await readFile(join(dist, 'cli', entry.implementation)))
  await writeFile(join(root, 'migrations.json'), JSON.stringify({
    migrations: [{
      package: '@isox-sh/cli',
      name: 'add-named-inputs',
      version: entry.version
    }]
  }))
  await writeFile(join(root, 'isox.json'), JSON.stringify(settings))

  return root
}

for (const [name, settings, expected] of [
  ['missing namedInputs', {
    version: '0.0.1',
    custom: true
  }, { default: ['{projectRoot}/**/*'] }],
  ['existing input sets', {
    namedInputs: { production: ['{projectRoot}/src/**/*'] },
    nx: { executors: ['@nx'] }
  }, {
    default: ['{projectRoot}/**/*'],
    production: ['{projectRoot}/src/**/*']
  }],
  ['custom default', { namedInputs: { default: ['{projectRoot}/src/**/*'] } }, { default: ['{projectRoot}/src/**/*'] }],
  ['empty default', { namedInputs: { default: [] } }, { default: [] }],
]) {
  test(`add-named-inputs migrates ${name} and is safe to rerun`, async t => {
    const root = await fixture(t, settings)
    await runMigrations(root)
    const first = await readFile(join(root, 'isox.json'), 'utf8')
    assert.deepEqual(JSON.parse(first), {
      ...settings,
      namedInputs: expected
    })
    await runMigrations(root)
    assert.equal(await readFile(join(root, 'isox.json'), 'utf8'), first)
  })
}

test('add-named-inputs rejects invalid configuration without replacing it', async t => {
  const root = await fixture(t, {})
  for (const invalid of ['[]', '{"namedInputs":null}', '{"namedInputs":[]}', '{broken']) {
    await writeFile(join(root, 'isox.json'), invalid)
    await assert.rejects(runMigrations(root), /Invalid/)
    assert.equal(await readFile(join(root, 'isox.json'), 'utf8'), invalid)
  }
})

test('upgrading alpha.4 to alpha.5 schedules the published named-inputs migration', async t => {
  const root = await fixture(t, {})
  const packageFile = join(root, 'node_modules/@isox-sh/cli/package.json')
  const manifest = JSON.parse(await readFile(packageFile, 'utf8'))
  await writeFile(packageFile, JSON.stringify({
    ...manifest,
    version: '1.0.0-alpha.4'
  }))
  await writeFile(join(root, 'package.json'), JSON.stringify({ devDependencies: { '@isox-sh/cli': '^1.0.0-alpha.4' } }))
  await rm(join(root, 'migrations.json'))
  const registry = JSON.parse(await readFile(join(dist, 'cli/migrations.json'), 'utf8'))
  await planMigrations(root, '1.0.0-alpha.5', async () => ({
    version: '1.0.0-alpha.5',
    migrations: registry.migrations
  }))
  const plan = JSON.parse(await readFile(join(root, 'migrations.json'), 'utf8'))
  assert.deepEqual(plan.migrations.map(({ name, version }) => ({
    name,
    version
  })), [{
    name: 'add-named-inputs',
    version: '1.0.0-alpha.5'
  }])
})
