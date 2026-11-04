import assert from 'node:assert/strict'
import { mkdir, mkdtemp, readFile, rm, stat, symlink, writeFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { test } from 'vitest'

const require = createRequire(import.meta.url)
const { installedVersions } = require('../../../dist/core/cache/tools')

test('persistent tool lookups detect installations, manifest edits, shadowing and removals', async t => {
  const root = await mkdtemp(join(tmpdir(), 'isox-tools-'))

  t.onTestFinished(() => rm(root, {
    recursive: true,
    force: true
  }))
  const manifest = join(root, 'packages/app/package.json')
  const write = async (path, value) => {
    await mkdir(join(root, path), { recursive: true })
    await writeFile(join(root, path, 'package.json'), JSON.stringify(value))
  }

  const versions = () => installedVersions([manifest], { root })

  await write('packages/app', {
    name: 'app',
    dependencies: { '@tools/compiler': '*' }
  })
  const missing = await versions()

  assert.equal(JSON.parse(await readFile(join(root, '.isox/tools.json'))).version, 1)
  const before = await stat(join(root, '.isox/tools.json'), { bigint: true })

  assert.deepEqual(await versions(), missing)
  assert.equal((await stat(join(root, '.isox/tools.json'), { bigint: true })).mtimeNs, before.mtimeNs)
  await write('node_modules/@tools/compiler', {
    name: '@tools/compiler',
    version: '1'
  })
  const installed = await versions()

  assert.notDeepEqual(installed, missing)
  assert.deepEqual(await versions(), installed)
  const cache = JSON.parse(await readFile(join(root, '.isox/tools.json')))

  for (const directory of Object.values(cache.directories)) {
    directory.names = []
  }

  await writeFile(join(root, '.isox/tools.json'), JSON.stringify(cache))
  assert.deepEqual(await versions(), installed)
  await write('node_modules/@tools/compiler', {
    name: '@tools/compiler',
    version: '2'
  })
  const updated = await versions()

  assert.notDeepEqual(updated, installed)
  await write('packages/app/node_modules/@tools/compiler', {
    name: '@tools/compiler',
    version: '3'
  })
  assert.notDeepEqual(await versions(), updated)
  await rm(join(root, 'packages/app/node_modules'), { recursive: true })
  await rm(join(root, 'node_modules'), { recursive: true })
  assert.deepEqual(await versions(), missing)
  await writeFile(join(root, '.isox/tools.json'), 'invalid JSON')
  assert.deepEqual(await versions(), missing)
})

test.skipIf(process.platform === 'win32')('persistent tool lookups follow changed package-directory symlinks', async t => {
  const root = await mkdtemp(join(tmpdir(), 'isox-tools-links-'))

  t.onTestFinished(() => rm(root, {
    recursive: true,
    force: true
  }))
  await writeFile(join(root, 'package.json'), JSON.stringify({ dependencies: { compiler: '*' } }))
  await mkdir(join(root, 'empty'))
  await mkdir(join(root, 'installed/compiler'), { recursive: true })
  await writeFile(join(root, 'installed/compiler/package.json'), JSON.stringify({ name: 'compiler' }))
  await symlink(join(root, 'empty'), join(root, 'node_modules'))
  const missing = await installedVersions([join(root, 'package.json')], { root })

  await rm(join(root, 'node_modules'))
  await symlink(join(root, 'installed'), join(root, 'node_modules'))
  assert.notDeepEqual(await installedVersions([join(root, 'package.json')], { root }), missing)
})

test('tool hashing includes workspace development tools but excludes installed packages development trees', async t => {
  const root = await mkdtemp(join(tmpdir(), 'isox-tool-scope-'))

  t.onTestFinished(() => rm(root, {
    recursive: true,
    force: true
  }))
  const write = async (name, manifest) => {
    const directory = join(root, 'node_modules', name)

    await mkdir(directory, { recursive: true })
    await writeFile(join(directory, 'package.json'), JSON.stringify({
      name,
      ...manifest
    }))
  }

  const workspaceManifest = join(root, 'package.json')

  await writeFile(workspaceManifest, JSON.stringify({ devDependencies: { compiler: '*' } }))
  await write('compiler', {
    dependencies: { runtime: '*' },
    devDependencies: { formatter: '*' },
    peerDependencies: { peer: '*' },
    optionalDependencies: { optional: '*' }
  })
  await write('runtime', { version: '1' })
  await write('formatter', { version: '1' })
  const versions = () => installedVersions([workspaceManifest], {
    root,
    developmentManifests: [workspaceManifest]
  })
  const initial = await versions()

  assert.ok(initial.some(([path]) => path.endsWith('/compiler/package.json')))
  assert.ok(!initial.some(([path]) => path.includes('/formatter/')))
  await write('formatter', { version: '2' })
  assert.deepEqual(await versions(), initial)
  await write('runtime', { version: '2' })
  const runtime = await versions()

  assert.notDeepEqual(runtime, initial)
  await write('peer', { version: '1' })
  const peer = await versions()

  assert.notDeepEqual(peer, runtime)
  await write('optional', { version: '1' })
  assert.notDeepEqual(await versions(), peer)

  // A linked workspace package still needs its own development tools, even if
  // it is also reached through another package's runtime dependencies.
  const compiler = join(root, 'node_modules/compiler/package.json')
  const linked = await installedVersions([workspaceManifest, compiler], {
    root,
    developmentManifests: [compiler]
  })

  assert.ok(linked.some(([path]) => path.endsWith('/formatter/package.json')))
  const published = await installedVersions([compiler], {
    root,
    developmentManifests: []
  })

  assert.ok(!published.some(([path]) => path.includes('/formatter/')))
})
