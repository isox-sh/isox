import assert from 'node:assert/strict'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'

import { test } from 'vitest'

const require = createRequire(import.meta.url)
const { getAffectedProjects, parseWorkspace } = require('../../../dist/core')

async function fixture(t) {
  const root = await mkdtemp(join(tmpdir(), 'isox-dependencies-'))
  t.onTestFinished(() => rm(root, { recursive: true, force: true }))
  const write = async (file, value) => {
    const path = join(root, file)
    await mkdir(dirname(path), { recursive: true })
    await writeFile(path, typeof value === 'string' ? value : JSON.stringify(value))
  }
  await write('isox.json', {})
  const project = async (name, manifest, definition = {}) => {
    await write(`packages/${name}/project.json`, { name, ...definition })
    if (manifest) {
      await write(`packages/${name}/package.json`, manifest)
    }
  }
  return { root, write, project }
}

test('infers package imports, types, exports and relative references, then caches merged edges', async t => {
  const { root, write, project } = await fixture(t)
  await project('app', { name: '@org/app' }, { dependencies: ['explicit'] })
  for (const name of ['lib', 'types', 'dynamic', 'relative', 'explicit', 'unused']) {
    await project(name, { name: `@org/${name}` })
  }
  await project('fs', { name: 'fs' })
  const definition = await readFile(join(root, 'packages/app/project.json'), 'utf8')
  await write('packages/app/src/index.ts', `
    import { thing } from '@org/lib/subpath'
    import type { Shape } from '@org/types'
    export { thing } from '@org/lib'
    import('@org/dynamic')
    require('../../relative/src/index')
    import '@org/app/self'
    import 'fs'
    // import '@org/unused'
    const text = "require('@org/unused')"
    require.resolve('@org/unused', { paths: ['/another/workspace'] })
  `)
  const workspace = await parseWorkspace(root)
  assert.deepEqual(workspace.projects.app.dependencies, ['dynamic', 'explicit', 'lib', 'relative', 'types'])
  assert.deepEqual(getAffectedProjects(workspace, ['packages/types/src/index.ts']), ['app', 'types'])
  const cache = JSON.parse(await readFile(join(root, '.isox/workspace.json'), 'utf8'))
  assert.deepEqual(cache.projects.app.dependencies, workspace.projects.app.dependencies)
  assert.equal(await readFile(join(root, 'packages/app/project.json'), 'utf8'), definition)
  await write('packages/app/src/index.ts', "import '@org/unused'")
  assert.deepEqual((await parseWorkspace(root)).projects.app.dependencies, workspace.projects.app.dependencies)
  assert.deepEqual((await parseWorkspace(root, { cache: false })).projects.app.dependencies, ['explicit', 'unused'])
})

test('resolves exact and wildcard TypeScript aliases with extends and project-specific overrides', async t => {
  const { root, write, project } = await fixture(t)
  for (const name of ['app', 'lib', 'types', 'unused']) {
    await project(name)
  }
  await write('config/paths.json', `{
    // Paths are relative to this config, including when it is extended.
    "compilerOptions": { "paths": {
      "@source/*": ["../packages/*/src/index.ts"],
      "@source/special": ["../packages/types/src/index.ts"],
      "@same-project": ["../packages/app/src/internal.ts"],
    } }
  }`)
  await write('tsconfig.base.json', { extends: './config/paths.json' })
  await write('packages/app/tsconfig.json', { extends: '../../tsconfig.base.json' })
  await write('packages/app/src/index.ts', "import '@source/lib'\nimport '@source/special'\nimport '@same-project'")
  assert.deepEqual((await parseWorkspace(root)).projects.app.dependencies, ['lib', 'types'])
  await write('packages/app/tsconfig.json', {
    extends: '../../tsconfig.base.json', compilerOptions: { paths: { '@source/*': ['../unused/src/*'] } },
  })
  assert.deepEqual((await parseWorkspace(root, { cache: false })).projects.app.dependencies, ['unused'])
})

test('maps aliases and relative imports to compiled output without requiring a build', async t => {
  const { root, write, project } = await fixture(t)
  await project('app')
  await project('lib')
  await write('tsconfig.base.json', { compilerOptions: { paths: { '@compiled/lib': ['./out/lib/index.d.ts'] } } })
  await write('packages/lib/tsconfig.json', { compilerOptions: { outDir: '../../out/lib' } })
  await write('packages/app/src/index.ts', "import '@compiled/lib'")
  await write('packages/app/tests/test.mjs', "require('../../../out/lib/index.js')")
  assert.deepEqual((await parseWorkspace(root)).projects.app.dependencies, ['lib'])
})

test('maps local package dependencies, aliases and paths to project names while ignoring external packages', async t => {
  const { root, project } = await fixture(t)
  await project('app', {
    name: '@org/app',
    dependencies: { '@org/lib': 'workspace:*', external: '^1.0.0' },
    devDependencies: { alias: 'workspace:@org/types@^' },
    peerDependencies: { named: 'npm:@org/peer@^1.0.0' },
    optionalDependencies: { linked: 'workspace:../linked' },
  })
  for (const name of ['lib', 'types', 'peer', 'linked']) {
    await project(name, { name: `@org/${name}` })
  }
  assert.deepEqual((await parseWorkspace(root)).projects.app.dependencies, ['lib', 'linked', 'peer', 'types'])
})

test('owns nested project files once and excludes dependency folders and generated outputs', async t => {
  const { root, write, project } = await fixture(t)
  await project('app')
  await project('lib', { name: '@org/lib' })
  await write('packages/app/nested/project.json', { name: 'nested' })
  await write('packages/app/nested/index.ts', "import '@org/lib'")
  await write('packages/app/node_modules/fake/index.js', "require('@org/lib')")
  await write('packages/app/dist/index.js', "require('@org/lib')")
  await write('packages/app/coverage/index.js', "require('@org/lib')")
  await write('packages/app/tsconfig.json', { compilerOptions: { outDir: './generated' } })
  await write('packages/app/generated/index.js', "require('@org/lib')")
  const workspace = await parseWorkspace(root)
  assert.equal(workspace.projects.app.dependencies, undefined)
  assert.deepEqual(workspace.projects.nested.dependencies, ['lib'])
})

test('rejects ambiguous package names and malformed manifests before saving a cache', async t => {
  const { root, write, project } = await fixture(t)
  await project('app', { name: '@org/same' })
  await project('lib', { name: '@org/same' })
  await assert.rejects(parseWorkspace(root), /Duplicate workspace package name @org\/same/)
  await write('packages/lib/package.json', '{broken')
  await assert.rejects(parseWorkspace(root), /Invalid package manifest/)
  await assert.rejects(readFile(join(root, '.isox/workspace.json')), { code: 'ENOENT' })
})

test('uses the first resolving paths fallback without adding false dependencies', async t => {
  const { root, write, project } = await fixture(t)
  for (const name of ['app', 'first', 'fallback']) {
    await project(name)
  }
  await write('tsconfig.base.json', { compilerOptions: { paths: {
    '@choice': ['packages/first/index.ts', 'packages/fallback/index.ts'],
  } } })
  await write('packages/first/index.ts', 'export {}')
  await write('packages/fallback/index.ts', 'export {}')
  await write('packages/app/index.ts', "import '@choice'")
  assert.deepEqual((await parseWorkspace(root)).projects.app.dependencies, ['first'])
  await rm(join(root, 'packages/first/index.ts'))
  assert.deepEqual((await parseWorkspace(root, { cache: false })).projects.app.dependencies, ['fallback'])
})

test('assigns shared output subdirectories to their source projects', async t => {
  const { root, write, project } = await fixture(t)
  for (const name of ['app', 'one', 'two']) {
    await project(name)
  }
  await write('tsconfig.base.json', { compilerOptions: { rootDir: '.', outDir: 'output' } })
  await write('packages/app/index.ts', "import '../../output/packages/two/index.js'")
  assert.deepEqual((await parseWorkspace(root)).projects.app.dependencies, ['two'])
})

test('discovers hidden projects and imports in hidden source directories', async t => {
  const { root, write, project } = await fixture(t)
  await project('app')
  await write('.tools/project.json', { name: 'tools' })
  await write('.tools/package.json', { name: '@org/tools' })
  await write('packages/app/.storybook/main.ts', "import '@org/tools'")
  assert.deepEqual((await parseWorkspace(root)).projects.app.dependencies, ['tools'])
})
