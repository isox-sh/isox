import { createRequire } from 'node:module'

import { test } from 'vitest'

const require = createRequire(import.meta.url)
const assert = require('node:assert/strict')
const { mkdtemp, mkdir, readFile, readdir, writeFile, rm, stat } = require('node:fs/promises')
const { tmpdir } = require('node:os')
const { dirname, join } = require('node:path')
const { fileURLToPath } = require('node:url')
const { parseWorkspace, resetWorkspace } = require('../../../dist/core')

async function fixture(t) {
  const root = await mkdtemp(join(tmpdir(), 'isox-cache-test-'))
  t.onTestFinished(() => rm(root, { recursive: true, force: true }))
  const write = async (file, content) => {
    const path = join(root, file)
    await mkdir(dirname(path), { recursive: true })
    await writeFile(path, typeof content === 'string' ? content : JSON.stringify(content))
  }
  await write('isox.json', {})
  return { root, write, cacheFile: join(root, '.isox/workspace.json') }
}

for (const [directory, asWorkspaceRoot] of [['apps/my app', false], ['apps/app:build', false], ['my workspace', true]]) {
  test(`rejects invalid derived names before caching (${directory}, workspace root: ${asWorkspaceRoot})`, async (t) => {
    const { root, write } = await fixture(t)
    const workspaceRoot = asWorkspaceRoot ? join(root, directory) : root
    const file = `${directory}/project.json`
    const cacheFile = join(workspaceRoot, '.isox/workspace.json')
    await write(file, {})
    await assert.rejects(parseWorkspace(workspaceRoot), /Invalid project name in .*project\.json/)
    await assert.rejects(stat(cacheFile), { code: 'ENOENT' })

    // An explicit valid name makes projects in these directories addressable.
    await write(file, { name: 'valid-name' })
    const workspace = await parseWorkspace(workspaceRoot)
    assert.equal(workspace.projects['valid-name'].root, asWorkspaceRoot ? '.' : directory)
    assert.deepEqual(await parseWorkspace(workspaceRoot), workspace)
  })
}

test('caches the complete workspace and reuses it without reading project files', async (t) => {
  const { root, write, cacheFile } = await fixture(t)
  const project = {
    name: 'demo',
    dependencies: ['lib'],
    tags: ['app'],
    custom: { owner: 'demo-team', enabled: true },
    sourceRoot: 'apps/demo/src',
    executors: { build: { executor: 'plugin:build', options: { nested: { value: 42 } }, custom: ['extra'] } },
  }
  await write('apps/demo/project.json', project)
  await write('libs/lib/project.json', { name: 'lib' })
  await write('.isox/ignored/project.json', { name: 'ignored' })
  const discovered = await parseWorkspace(root)
  const cached = JSON.parse(await readFile(cacheFile, 'utf8'))
  assert.equal(cached.version, 5)
  assert.deepEqual(cached.projects.demo, { ...project, root: 'apps/demo' })
  assert.deepEqual(Object.keys(cached.projects).sort(), ['demo', 'lib'])

  await write('apps/demo/project.json', '{broken')
  await rm(join(root, 'libs'), { recursive: true })
  await write('apps/new/project.json', { name: 'new' })
  assert.deepEqual(await parseWorkspace(root), discovered)
})

test('migrates Nx projects into the cache without modifying project files and reuses the migrated cache', async (t) => {
  const { root, write, cacheFile } = await fixture(t)
  const file = 'apis/dashboard/project.json'
  const project = {
    $schema: '../../node_modules/nx/schemas/project-schema.json',
    name: 'dashboard',
    sourceRoot: 'apis/dashboard/src',
    projectType: 'application',
    implicitDependencies: ['shared'],
    custom: { owner: 'dashboard-team' },
    targets: { build: { executor: '@nx/js:tsc', options: { outputPath: 'dist/dashboard' }, custom: true } },
  }
  const source = `${JSON.stringify(project, null, 4)}\n`
  await write(file, source)
  // The previous cache format could contain unconverted Nx projects.
  await write('.isox/workspace.json', { version: 3, projects: { dashboard: { ...project, root: 'apis/dashboard' } } })

  const workspace = await parseWorkspace(root)
  const migrated = workspace.projects.dashboard
  assert.deepEqual(migrated.executors, project.targets)
  assert.deepEqual(migrated.dependencies, project.implicitDependencies)
  assert.deepEqual(migrated.custom, project.custom)
  assert.equal(migrated.sourceRoot, project.sourceRoot)
  assert.equal(migrated.root, 'apis/dashboard')
  assert.equal(Object.hasOwn(migrated, 'targets'), false)
  assert.equal(Object.hasOwn(migrated, 'implicitDependencies'), false)
  const schema = JSON.parse(await readFile(fileURLToPath(migrated.$schema), 'utf8'))
  assert.equal(schema.title, 'Isox project')
  assert.equal(await readFile(join(root, file), 'utf8'), source)
  assert.deepEqual(JSON.parse(await readFile(cacheFile, 'utf8')).projects.dashboard, migrated)

  await write(file, '{broken')
  assert.deepEqual(await parseWorkspace(root), workspace)
  await resetWorkspace(root)
  await assert.rejects(parseWorkspace(root), SyntaxError)
})

test('rebuilds malformed, incompatible, and structurally invalid caches', async (t) => {
  const { root, write, cacheFile } = await fixture(t)
  await write('apps/demo/project.json', { name: 'demo' })
  for (const content of [
    '{broken',
    'null',
    { version: 1, projects: {} },
    { version: 2, projects: { stale: { name: 'stale', root: '.' } } },
    { version: 3, projects: { stale: { name: 'stale', root: '.' } } },
    { version: 5, projects: { demo: { name: 'demo', root: '.', $schema: 'nx/schemas/project-schema.json', targets: {} } } },
    { version: 5, projects: { demo: { name: 'demo', root: '.', executors: [] } } },
    { version: 999, projects: {} },
    { version: 5, projects: [] },
    { version: 5, projects: { demo: { name: 'different', root: 'apps/demo' } } },
  ]) {
    await write('.isox/workspace.json', content)
    const workspace = await parseWorkspace(root)
    assert.equal(workspace.projects.demo.root, 'apps/demo')
    assert.equal(JSON.parse(await readFile(cacheFile, 'utf8')).version, 5)
  }
})

test('cached projects preserve dictionary semantics for special names', async (t) => {
  const { root, write } = await fixture(t)
  await write('apps/demo/project.json', { name: '__proto__' })
  const discovered = await parseWorkspace(root)
  const cached = await parseWorkspace(root)
  assert.deepEqual(cached, discovered)
  assert.equal(Object.getPrototypeOf(cached.projects), null)
  assert.equal(cached.projects.__proto__.root, 'apps/demo')
  assert.equal(cached.projects.toString, undefined)
})

test('does not save a cache when project discovery fails', async (t) => {
  const { root, write, cacheFile } = await fixture(t)
  await write('apps/demo/project.json', '{broken')
  await assert.rejects(parseWorkspace(root))
  await assert.rejects(stat(cacheFile), { code: 'ENOENT' })
})

test('concurrent discovery publishes valid JSON and leaves no temporary files', async (t) => {
  const { root, write, cacheFile } = await fixture(t)
  await write('apps/demo/project.json', { name: 'demo' })
  const workspaces = await Promise.all(Array.from({ length: 8 }, () => parseWorkspace(root)))
  assert.ok(workspaces.every(workspace => workspace.projects.demo.root === 'apps/demo'))
  assert.equal(JSON.parse(await readFile(cacheFile, 'utf8')).projects.demo.name, 'demo')
  assert.deepEqual(await readdir(join(root, '.isox')), ['workspace.json'])
})

test('reset removes a corrupt cache', async (t) => {
  const { root, write } = await fixture(t)
  await write('.isox/workspace.json', '{broken')
  await resetWorkspace(root)
  await assert.rejects(stat(join(root, '.isox')), { code: 'ENOENT' })
})

test('rebuilds caches using the former commands field', async (t) => {
  const { root, write, cacheFile } = await fixture(t)
  const executors = { build: { executor: 'plugin:build' } }
  await write('apps/demo/project.json', { name: 'demo', executors })
  await write('.isox/workspace.json', {
    version: 4,
    projects: { demo: { name: 'demo', root: 'apps/demo', commands: executors } },
  })
  const workspace = await parseWorkspace(root)
  assert.deepEqual(workspace.projects.demo.executors, executors)
  assert.equal(Object.hasOwn(workspace.projects.demo, 'commands'), false)
  assert.equal(JSON.parse(await readFile(cacheFile, 'utf8')).version, 5)
})
