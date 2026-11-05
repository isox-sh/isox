import assert from 'node:assert/strict'
import { mkdir, mkdtemp, readdir, readFile, rm, stat, utimes, writeFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'

import { test, vi } from 'vitest'

const require = createRequire(import.meta.url)
const { parseWorkspace, resetWorkspace, resolveWorkspaceDependencies } = require('../../../dist/core')

async function fixture(t) {
  const root = await mkdtemp(join(tmpdir(), 'isox-dependency-cache-'))

  t.onTestFinished(() => rm(root, {
    recursive: true,
    force: true
  }))
  const write = async (file, value) => {
    const path = join(root, file)

    await mkdir(dirname(path), { recursive: true })
    await writeFile(path, typeof value === 'string' ? value : JSON.stringify(value))
  }

  await write('isox.json', {})
  for (const name of ['app', 'lib', 'other']) {
    await write(`${name}/project.json`, { name })
    await write(`${name}/package.json`, { name: `@test/${name}` })
    await write(`${name}/index.ts`, 'export {}')
  }

  await write('app/index.ts', "import '@test/lib'")
  await write('other/index.ts', "import '@test/lib'")
  const definitions = await parseWorkspace(root)

  return {
    root,
    write,
    definitions,
    cacheFile: join(root, '.isox/discovery.json'),
    infer: projects => resolveWorkspaceDependencies(root, definitions, projects ? { projects } : undefined)
  }
}

test('dependency caching is lazy, preserves scoped coverage and leaves definitions untouched', async t => {
  const { root, definitions, infer, cacheFile } = await fixture(t)
  const workspaceFile = join(root, '.isox/workspace.json')
  const before = await readFile(workspaceFile, 'utf8')

  await assert.rejects(stat(cacheFile), { code: 'ENOENT' })
  await resolveWorkspaceDependencies(root, definitions, { projects: [] })
  await assert.rejects(stat(cacheFile), { code: 'ENOENT' })
  await infer(['app'])
  const cached = JSON.parse(await readFile(cacheFile, 'utf8'))

  assert.deepEqual(Object.keys(cached.projects).sort(), ['app', 'lib'])
  assert.deepEqual(cached.projects.app.dependencies, ['lib'])
  assert.equal(definitions.projects.app.dependencies, undefined)
  assert.equal(await readFile(workspaceFile, 'utf8'), before)

  const read = vi.spyOn(require('node:fs/promises'), 'readFile')

  t.onTestFinished(() => read.mockRestore())
  assert.deepEqual(await parseWorkspace(root), definitions)
  assert.deepEqual(read.mock.calls.map(([file]) => file), [workspaceFile])
  read.mockClear()

  const time = (await stat(cacheFile)).mtimeMs
  const warm = await infer(['app'])

  assert.deepEqual(warm.projects.app.dependencies, ['lib'])
  assert.equal(warm.projects.other.dependencies, undefined)
  assert.equal(read.mock.calls.some(([file]) => file.endsWith('.ts')), false)
  assert.equal((await stat(cacheFile)).mtimeMs, time)
  read.mockClear()

  const full = await infer()

  assert.deepEqual(full.projects.other.dependencies, ['lib'])
  assert.deepEqual(read.mock.calls.map(([file]) => file).filter(file => file.endsWith('.ts')), [join(root, 'other/index.ts')])
  assert.deepEqual(Object.keys(JSON.parse(await readFile(cacheFile, 'utf8')).projects).sort(), ['app', 'lib', 'other'])
  await resetWorkspace(root)
  await assert.rejects(stat(cacheFile), { code: 'ENOENT' })
})

test('changed imports, source membership and ignore rules refresh requested projects', async t => {
  const { root, write, infer } = await fixture(t)

  await infer(['app'])
  // A dependency's imports must be validated even when its consumer is cached.
  await write('lib/index.ts', "import '@test/other'")
  const changed = await infer(['app'])

  assert.deepEqual(changed.projects.lib.dependencies, ['other'])
  await write('lib/index.ts', 'export {}')
  await write('app/index.ts', "import '@test/other'")
  assert.deepEqual((await infer(['app'])).projects.app.dependencies, ['other'])
  await write('app/index.ts', 'export {}')
  assert.equal((await infer(['app'])).projects.app.dependencies, undefined)
  await write('app/new.ts', "import '@test/lib'")
  assert.deepEqual((await infer(['app'])).projects.app.dependencies, ['lib'])
  await write('.isoxignore', 'app/new.ts\n')
  assert.equal((await infer(['app'])).projects.app.dependencies, undefined)
  await rm(join(root, '.isoxignore'))
  assert.deepEqual((await infer(['app'])).projects.app.dependencies, ['lib'])
  await rm(join(root, 'app/new.ts'))
  assert.equal((await infer(['app'])).projects.app.dependencies, undefined)
})

test('source replacement is detected when size and mtime are preserved', async t => {
  const { root, write, infer } = await fixture(t)

  await write('app/index.ts', "import '@test/lib'   ")
  await infer(['app'])
  const path = join(root, 'app/index.ts')
  const before = await stat(path)

  await write('app/index.ts', "import '@test/other' ")
  assert.equal((await stat(path)).size, before.size)
  await utimes(path, before.atime, before.mtime)
  assert.deepEqual((await infer(['app'])).projects.app.dependencies, ['other'])
})

test('package metadata, extended configs and supplied definitions invalidate cached edges', async t => {
  const { root, write, definitions, infer } = await fixture(t)

  await infer()
  await write('app/index.ts', 'export {}')
  await write('app/package.json', {
    name: '@test/app',
    dependencies: { '@test/other': '*' }
  })
  assert.deepEqual((await infer(['app'])).projects.app.dependencies, ['other'])
  await write('app/package.json', { name: '@test/app' })
  await write('app/index.ts', "import '@alias'")
  await write('tsconfig.base.json', { extends: './node_modules/config/base.json' })
  await write('node_modules/config/base.json', { compilerOptions: { paths: { '@alias': ['../../lib/index.ts'] } } })
  assert.deepEqual((await infer(['app'])).projects.app.dependencies, ['lib'])
  await write('node_modules/config/base.json', { compilerOptions: { paths: { '@alias': ['../../other/index.ts'] } } })
  assert.deepEqual((await infer(['app'])).projects.app.dependencies, ['other'])
  const updated = structuredClone(definitions)

  updated.projects.app.dependencies = ['lib']
  const resolved = await resolveWorkspaceDependencies(root, updated, { projects: ['app'] })

  assert.deepEqual(resolved.projects.app.dependencies, ['lib', 'other'])
})

test('resolution probes detect ignored output files and missing directories appearing', async t => {
  const { root, write, infer } = await fixture(t)

  await write('.gitignore', 'generated/\n')
  await write('lib/tsconfig.json', { compilerOptions: { outDir: '../generated/lib' } })
  await write('other/tsconfig.json', { compilerOptions: { outDir: '../generated/other' } })
  await write('tsconfig.base.json', {
    compilerOptions: { paths: { '@alias': ['./generated/lib/index.d.ts', './generated/other/index.d.ts'] } }
  })
  await write('app/index.ts', "import '@alias'")
  await write('generated/other/index.d.ts', 'export {}')
  assert.deepEqual((await infer(['app'])).projects.app.dependencies, ['other'])
  await write('generated/lib/index.d.ts', 'export {}')
  assert.deepEqual((await infer(['app'])).projects.app.dependencies, ['lib'])
  await rm(join(root, 'generated/lib'), { recursive: true })
  assert.deepEqual((await infer(['app'])).projects.app.dependencies, ['other'])
})

test('corrupt caches and concurrent scoped writers recover without claiming uncomputed projects', async t => {
  const { root, write, infer, cacheFile } = await fixture(t)

  await infer(['app'])
  const valid = JSON.parse(await readFile(cacheFile, 'utf8'))

  for (const value of ['{broken', { version: 1 }, {
    ...valid,
    projects: []
  }, {
    ...valid,
    projects: {
      app: {
        ...valid.projects.app,
        dependencies: [42]
      }
    }
  }, {
    ...valid,
    projects: {
      app: {
        ...valid.projects.app,
        reads: [{
          path: root,
          kind: 'directory',
          value: 'false'
        }]
      }
    }
  }]) {
    await write('.isox/discovery.json', value)
    assert.deepEqual((await infer(['app'])).projects.app.dependencies, ['lib'])
  }

  await rm(cacheFile)
  await write('.isox/discovery.json/keep', 'keep')
  await infer(['app'])
  const backup = (await readdir(join(root, '.isox'))).find(file => file.endsWith('.invalid'))

  assert.equal(await readFile(join(root, '.isox', backup, 'keep'), 'utf8'), 'keep')
  await rm(cacheFile)
  const results = await Promise.all([infer(['app']), infer(['other']), infer(['lib'])])

  assert.deepEqual(results[0].projects.app.dependencies, ['lib'])
  assert.deepEqual(results[1].projects.other.dependencies, ['lib'])
  assert.ok(JSON.parse(await readFile(cacheFile, 'utf8')).projects.lib)
  assert.equal((await readdir(join(root, '.isox'))).some(file => file.endsWith('.tmp')), false)
  assert.deepEqual((await infer()).projects.other.dependencies, ['lib'])
})
