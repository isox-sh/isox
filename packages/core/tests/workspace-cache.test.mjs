import { createRequire } from 'node:module'

import { test, vi } from 'vitest'

const require = createRequire(import.meta.url)
const assert = require('node:assert/strict')
const { mkdtemp, mkdir, readFile, readdir, writeFile, rm, stat, rename, symlink, utimes } = require('node:fs/promises')
const { tmpdir } = require('node:os')
const { dirname, join } = require('node:path')
const { fileURLToPath } = require('node:url')
const { parseWorkspace, resetWorkspace } = require('../../../dist/core')

async function fixture(t) {
  const root = await mkdtemp(join(tmpdir(), 'isox-cache-test-'))

  t.onTestFinished(() => rm(root, {
    recursive: true,
    force: true
  }))
  const write = async (file, content) => {
    const path = join(root, file)

    await mkdir(dirname(path), { recursive: true })
    await writeFile(path, typeof content === 'string' ? content : JSON.stringify(content))
  }

  await write('isox.json', {})

  return {
    root,
    write,
    cacheFile: join(root, '.isox/workspace.json')
  }
}

for (const [directory, asWorkspaceRoot] of [['apps/my app', false], ['apps/app:build', false], ['my workspace', true]]) {
  test.skipIf(process.platform === 'win32' && directory.includes(':'))(`rejects invalid derived names before caching (${directory}, workspace root: ${asWorkspaceRoot})`, async (t) => {
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

test('reuses an unchanged discovery snapshot without rewriting the cache', async (t) => {
  const { root, write, cacheFile } = await fixture(t)
  const project = {
    name: 'demo',
    dependencies: ['lib'],
    tags: ['app'],
    custom: {
      owner: 'demo-team',
      enabled: true
    },
    sourceRoot: 'apps/demo/src',
    targets: {
      build: {
        executor: 'plugin:build',
        options: { nested: { value: 42 } },
        custom: ['extra']
      }
    },
  }

  await write('apps/demo/project.json', project)
  await write('libs/lib/project.json', { name: 'lib' })
  await write('.isox/ignored/project.json', { name: 'ignored' })
  const discovered = await parseWorkspace(root)
  const cached = JSON.parse(await readFile(cacheFile, 'utf8'))

  assert.equal(cached.version, 14)
  assert.deepEqual(Object.keys(cached).sort(), ['projects', 'version'])
  assert.deepEqual(cached.projects.demo, {
    ...project,
    root: 'apps/demo'
  })
  assert.deepEqual(Object.keys(cached.projects).sort(), ['demo', 'lib'])

  const before = await stat(cacheFile)

  assert.deepEqual(await parseWorkspace(root), discovered)
  assert.equal((await stat(cacheFile)).mtimeMs, before.mtimeMs)
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
    targets: {
      build: {
        executor: '@nx/js:tsc',
        options: { outputPath: 'dist/dashboard' },
        custom: true
      },
      'extract-translations': { options: { outputPath: 'locales' } },
    },
  }
  const source = `${JSON.stringify(project, null, 4)}\n`

  await write(file, source)
  // The previous cache format could contain unconverted Nx projects.
  await write('.isox/workspace.json', {
    version: 3,
    projects: {
      dashboard: {
        ...project,
        root: 'apis/dashboard'
      }
    }
  })

  const workspace = await parseWorkspace(root)
  const migrated = workspace.projects.dashboard

  assert.deepEqual(migrated.targets, { build: project.targets.build })
  assert.deepEqual(migrated.dependencies, project.implicitDependencies)
  assert.deepEqual(migrated.custom, project.custom)
  assert.equal(migrated.sourceRoot, project.sourceRoot)
  assert.equal(migrated.root, 'apis/dashboard')
  assert.equal(Object.hasOwn(migrated, 'executors'), false)
  assert.equal(Object.hasOwn(migrated, 'implicitDependencies'), false)
  const schema = JSON.parse(await readFile(fileURLToPath(migrated.$schema), 'utf8'))

  assert.equal(schema.title, 'Isox project')
  assert.equal(await readFile(join(root, file), 'utf8'), source)
  assert.deepEqual(JSON.parse(await readFile(cacheFile, 'utf8')).projects.dashboard, migrated)

  assert.deepEqual(await parseWorkspace(root), workspace)
  await write(file, '{broken')
  assert.deepEqual(await parseWorkspace(root), workspace)
  await assert.rejects(parseWorkspace(root, { cache: false }), SyntaxError)
})

test('rebuilds malformed, incompatible, and structurally invalid caches', async (t) => {
  const { root, write, cacheFile } = await fixture(t)

  await write('apps/demo/project.json', { name: 'demo' })
  for (const content of [
    '{broken',
    'null',
    {
      version: 1,
      projects: {}
    },
    {
      version: 2,
      projects: {
        stale: {
          name: 'stale',
          root: '.'
        }
      }
    },
    {
      version: 3,
      projects: {
        stale: {
          name: 'stale',
          root: '.'
        }
      }
    },
    {
      version: 5,
      projects: {
        stale: {
          name: 'stale',
          root: '.'
        }
      }
    },
    {
      version: 14,
      projects: {
        demo: {
          name: 'demo',
          root: '.',
          $schema: 'nx/schemas/project-schema.json',
          targets: {}
        }
      }
    },
    {
      version: 14,
      projects: {
        demo: {
          name: 'demo',
          root: '.',
          targets: []
        }
      }
    },
    {
      version: 999,
      projects: {}
    },
    {
      version: 14,
      projects: []
    },
    {
      version: 14,
      projects: {
        demo: {
          name: 'different',
          root: 'apps/demo'
        }
      }
    },
  ]) {
    await write('.isox/workspace.json', content)
    const workspace = await parseWorkspace(root)

    assert.equal(workspace.projects.demo.root, 'apps/demo')
    assert.equal(JSON.parse(await readFile(cacheFile, 'utf8')).version, 14)
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
  await write('apps/demo/index.ts', 'export {}')
  const workspaces = await Promise.all(Array.from({ length: 8 }, () => parseWorkspace(root)))

  assert.ok(workspaces.every(workspace => workspace.projects.demo.root === 'apps/demo'))
  assert.equal(JSON.parse(await readFile(cacheFile, 'utf8')).projects.demo.name, 'demo')
  assert.deepEqual((await readdir(join(root, '.isox'))).sort(), ['workspace.json'])
})

test('reset removes a corrupt cache', async (t) => {
  const { root, write } = await fixture(t)

  await write('.isox/workspace.json', '{broken')
  await resetWorkspace(root)
  await assert.rejects(stat(join(root, '.isox')), { code: 'ENOENT' })
})

for (const [field, version] of [['commands', 4], ['executors', 7]]) {
  test(`rebuilds caches using the former ${field} field`, async t => {
    const { root, write, cacheFile } = await fixture(t)
    const targets = { build: { executor: 'plugin:build' } }

    await write('apps/demo/project.json', {
      name: 'demo',
      targets
    })
    await write('.isox/workspace.json', {
      version,
      projects: {
        demo: {
          name: 'demo',
          root: 'apps/demo',
          [field]: targets
        }
      },
    })
    const workspace = await parseWorkspace(root)

    assert.deepEqual(workspace.projects.demo.targets, targets)
    assert.equal(Object.hasOwn(workspace.projects.demo, field), false)
    assert.equal(JSON.parse(await readFile(cacheFile, 'utf8')).version, 14)
    assert.deepEqual(await parseWorkspace(root), workspace)
  })
}

test('rebuilds a directory-shaped cache while preserving its contents in a backup', async t => {
  const { root, write, cacheFile } = await fixture(t)

  await write('.isox/workspace.json/keep.txt', 'keep')
  await write('apps/demo/project.json', { name: 'demo' })
  assert.equal((await parseWorkspace(root)).projects.demo.name, 'demo')
  assert.equal(JSON.parse(await readFile(cacheFile, 'utf8')).projects.demo.name, 'demo')
  const backup = (await readdir(join(root, '.isox'))).find(file => file.endsWith('.invalid'))

  assert.equal(await readFile(join(root, '.isox', backup, 'keep.txt'), 'utf8'), 'keep')
})

test('explicit refresh discovers added, edited, renamed and removed project definitions', async t => {
  const { root, write } = await fixture(t)

  await write('apps/one/project.json', { name: 'one' })
  assert.deepEqual(Object.keys((await parseWorkspace(root, { cache: false })).projects), ['one'])
  const file = join(root, 'apps/one/project.json')
  const before = await stat(file)

  await write('apps/one/project.json', { name: 'two' })
  await utimes(file, before.atime, before.mtime)
  assert.deepEqual(Object.keys((await parseWorkspace(root, { cache: false })).projects), ['two'])
  await rename(join(root, 'apps/one'), join(root, 'apps/moved'))
  assert.equal((await parseWorkspace(root, { cache: false })).projects.two.root, 'apps/moved')
  await write('libs/new/project.json', { name: 'new' })
  assert.deepEqual(Object.keys((await parseWorkspace(root, { cache: false })).projects).sort(), ['new', 'two'])
  await rm(join(root, 'apps'), { recursive: true })
  assert.deepEqual(Object.keys((await parseWorkspace(root, { cache: false })).projects), ['new'])
})

test('nested workspaces, generated output, excluded projects and symlinks share discovery boundaries', async t => {
  const { root, write } = await fixture(t)

  await write('project.json', { name: 'root' })
  await write('lib/project.json', { name: 'lib' })
  await write('lib/package.json', { name: '@test/lib' })
  await write('.gitignore', 'dist/\nbuild/\ncoverage/\n.nx/\n/tmp/\n')
  await write('.isoxignore', 'vendor/\ngenerated/\n')
  for (const directory of ['dist', 'app/build', 'coverage', '.nx', 'node_modules', 'vendor', 'generated', 'tmp', 'nested']) {
    await write(`${directory}/project.json`, '{invalid')
    await write(`${directory}/index.ts`, "import '@test/lib'")
  }

  await write('nested/isox.json', {})
  await symlink(join(root, 'nested'), join(root, 'linked'), 'junction')
  const workspace = await parseWorkspace(root, { cache: false })

  assert.deepEqual(Object.keys(workspace.projects).sort(), ['lib', 'root'])
  assert.equal(workspace.projects.root.dependencies, undefined)
  await write('nested/project.json', { name: 'nested' })
  await rm(join(root, 'nested/isox.json'))
  assert.ok((await parseWorkspace(root, { cache: false })).projects.nested)
  await write('nested/isox.json', {})
  assert.equal((await parseWorkspace(root, { cache: false })).projects.nested, undefined)
  await write('vendor/project.json', { name: 'vendor' })
  await write('.isoxignore', 'generated/\n')
  assert.ok((await parseWorkspace(root, { cache: false })).projects.vendor)
})

test('honors nested gitignore rules, negation, and additive isoxignore without requiring Git', async t => {
  const { root, write } = await fixture(t)

  await write('.gitignore', '*.json\n!isox.json\n!project.json\nignored/\n')
  await write('project.json', { name: 'root' })
  await write('ignored/project.json', '{broken')
  await write('ignored/.gitignore', '!project.json\n')
  await write('packages/.gitignore', 'hidden/\ncase/\n')
  await write('packages/hidden/project.json', '{broken')
  await write('packages/Case/project.json', { name: 'Case' })
  await write('packages/keep/project.json', { name: 'keep' })
  await write('packages/omit/project.json', { name: 'omit' })
  await write('.isoxignore', '/packages/*\n!/packages/keep/\n')
  assert.deepEqual(Object.keys((await parseWorkspace(root, { cache: false })).projects).sort(), ['keep', 'root'])
  await write('.isoxignore', '')
  assert.deepEqual(Object.keys((await parseWorkspace(root, { cache: false })).projects).sort(), ['Case', 'keep', 'omit', 'root'])
  await write('packages/hidden/project.json', { name: 'hidden' })
  await write('packages/.gitignore', '')
  assert.deepEqual(Object.keys((await parseWorkspace(root, { cache: false })).projects).sort(), ['Case', 'hidden', 'keep', 'omit', 'root'])
})

test('workspace rebuilds report progress and completion while cache hits stay quiet', async t => {
  const { createLogger } = require('../../../dist/core')
  const { root, write } = await fixture(t)
  const entries = []
  let starts = 0
  let stops = 0
  const taskLogger = createLogger({
    reporters: [{
      log: entry => entries.push(entry),
      progress: () => {
        starts++

        return () => {
          stops++
        }
      }
    }]
  })

  await write('project.json', { name: 'demo' })
  await parseWorkspace(root, { logger: taskLogger })
  assert.equal(starts, 1)
  assert.equal(stops, 1)
  assert.match(entries.find(entry => entry.type === 'success').args[0], /Rebuilt \.isox\/workspace\.json \(1 project\) in \d+\.\d{2}s\./)
  entries.length = 0
  await parseWorkspace(root, { logger: taskLogger })
  assert.equal(starts, 1)
  assert.equal(entries.length, 0)

  await write('project.json', { name: 'changed' })
  await parseWorkspace(root, {
    cache: false,
    logger: taskLogger
  })
  assert.equal(starts, 2)
  assert.equal(stops, 2)

  entries.length = 0
  await write('project.json', '{invalid')
  await assert.rejects(parseWorkspace(root, {
    cache: false,
    logger: taskLogger
  }), SyntaxError)
  assert.equal(starts, 3)
  assert.equal(stops, 3)
  assert.equal(entries.some(entry => entry.type === 'success'), false)
})

test('cached discovery reads only resolved definitions without probing settings, sources or manifests', async t => {
  const { root, write, cacheFile } = await fixture(t)

  await write('app/project.json', { name: 'app' })
  await write('app/index.ts', "import '@test/lib'")
  await write('app/tsconfig.json', '{broken')
  await write('app/package.json', '{broken')
  const expected = await parseWorkspace(root)
  const before = await stat(cacheFile)

  assert.equal(expected.projects.app.dependencies, undefined)
  assert.deepEqual(await readdir(join(root, '.isox')), ['workspace.json'])
  await write('app/index.ts', "import '@test/other'\nexport const value = 2")
  await write('app/project.json', { name: 'renamed' })
  const fs = require('node:fs/promises')
  const read = vi.spyOn(fs, 'readFile')
  const walk = vi.spyOn(fs, 'readdir')
  const metadata = vi.spyOn(fs, 'stat')

  t.onTestFinished(() => {
    read.mockRestore()
    walk.mockRestore()
    metadata.mockRestore()
  })
  assert.deepEqual(await parseWorkspace(root), expected)
  assert.deepEqual(read.mock.calls.map(([file]) => file), [cacheFile])
  assert.equal(walk.mock.calls.length, 0)
  assert.equal(metadata.mock.calls.length, 0)
  assert.equal((await stat(cacheFile)).mtimeMs, before.mtimeMs)

  await resetWorkspace(root)
  const refreshed = await parseWorkspace(root)

  assert.equal(refreshed.projects.app, undefined)
  assert.ok(refreshed.projects.renamed)
})
