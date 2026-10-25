import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { mkdir, mkdtemp, readdir, readFile, rm, symlink, writeFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'

import { test } from 'vitest'

const cliPath = resolve(import.meta.dirname, '../../../dist/cli/index.js')
const jsPackage = resolve(import.meta.dirname, '../../../dist/js')
const require = createRequire(import.meta.url)

function typecheck(root, project, packageName, bin) {
  const manifest = require.resolve(`${packageName}/package.json`)

  return spawnSync(process.execPath, [
    resolve(dirname(manifest), require(manifest).bin[bin]),
    '--project', `${project}/tsconfig.json`, '--pretty', 'false',
  ], {
    cwd: root,
    encoding: 'utf8'
  })
}

async function fixture(t, workspace = true) {
  const directory = await mkdtemp(join(tmpdir(), 'isox-init-project-'))

  t.onTestFinished(() => rm(directory, {
    recursive: true,
    force: true
  }))
  const root = join(directory, 'workspace')

  await mkdir(root)

  if (workspace) {
    await writeFile(join(root, 'isox.json'), '{}\n')
  }

  await mkdir(join(root, 'node_modules/@isox-sh'), { recursive: true })
  await symlink(jsPackage, join(root, 'node_modules/@isox-sh/js'), 'junction')

  return root
}

function run(cwd, ...args) {
  return spawnSync(process.execPath, [cliPath, ...args], {
    cwd,
    encoding: 'utf8'
  })
}

async function readJson(file) {
  return JSON.parse(await readFile(file, 'utf8'))
}

test('init creates a buildable JS project and adds its import alias to a new base config', async (t) => {
  const root = await fixture(t)

  await mkdir(join(root, '.isox'))
  await writeFile(join(root, '.isox/workspace.json'), JSON.stringify({
    version: 5,
    projects: {}
  }))
  await writeFile(join(root, '.isox/keep'), 'other cache data')
  const result = run(root, 'init', '@isox-sh/js', 'packages/test', '--importPath=@org/test')

  assert.equal(result.status, 0, result.stderr)
  assert.deepEqual(result.stdout.match(/packages\/test\/(?:project|tsconfig(?:\.build)?)\.json/g), [
    'packages/test/project.json', 'packages/test/tsconfig.json', 'packages/test/tsconfig.build.json',
  ])
  const project = await readJson(join(root, 'packages/test/project.json'))

  assert.equal(project.name, 'test')
  assert.equal(project.targets.build.executor, '@isox-sh/js:tsc')
  assert.equal(project.targets.build.options.tsConfig, './packages/test/tsconfig.build.json')
  assert.equal((await readJson(join(root, 'packages/test/tsconfig.json'))).extends, '../../tsconfig.base.json')
  assert.equal((await readJson(join(root, 'packages/test/tsconfig.json'))).compilerOptions.noEmit, true)
  assert.equal((await readJson(join(root, 'packages/test/tsconfig.build.json'))).compilerOptions.outDir, '../../dist/packages/test')
  const base = await readJson(join(root, 'tsconfig.base.json'))

  assert.deepEqual(base.compilerOptions.paths, { '@org/test': ['./packages/test/src/index.ts'] })
  assert.equal(await readFile(join(root, '.isox/keep'), 'utf8'), 'other cache data')
  assert.equal(await readFile(join(root, 'isox.json'), 'utf8'), '{}\n')
  const build = run(root, 'build', 'test')

  assert.equal(build.status, 0, build.stderr)
  assert.ok((await readdir(join(root, 'dist/packages/test'))).includes('index.js'))
})

test('init resolves relative paths from a nested cwd and preserves an existing base config without an alias', async (t) => {
  const root = await fixture(t)
  const source = '{\n  // keep this comment\n  "compilerOptions": { "strict": true, },\n}\n'

  await writeFile(join(root, 'tsconfig.base.json'), source)
  await mkdir(join(root, 'packages'))
  const result = run(join(root, 'packages'), 'init', '@isox-sh/js', 'nested')

  assert.equal(result.status, 0, result.stderr)
  assert.equal((await readJson(join(root, 'packages/nested/project.json'))).name, 'nested')
  assert.equal((await readJson(join(root, 'packages/nested/tsconfig.build.json'))).compilerOptions.outDir, '../../dist/packages/nested')
  assert.equal(await readFile(join(root, 'tsconfig.base.json'), 'utf8'), source)
})

for (const composite of [false, true]) {
  test(`initialized projects typecheck source aliases before building and retain their output layout (composite base: ${composite})`, async (t) => {
    const root = await fixture(t)
    const editorConfig = '{ "files": [], "references": [] }\n'

    await writeFile(join(root, 'tsconfig.json'), editorConfig)

    if (composite) {
      await writeFile(join(root, 'tsconfig.base.json'), JSON.stringify({
        compilerOptions: {
          target: 'ES2022',
          module: 'NodeNext',
          moduleResolution: 'NodeNext',
          declaration: true,
          strict: true,
          composite: true,
          noEmit: true,
          rootDir: './legacy/src',
        },
      }))
    }

    for (const [path, alias] of [['libraries/shared', '@org/shared'], ['apps/deep/consumer', '@org/consumer']]) {
      const result = run(root, 'init', '@isox-sh/js', path, `--importPath=${alias}`)

      assert.equal(result.status, 0, result.stdout + result.stderr)
    }

    await writeFile(join(root, 'libraries/shared/src/index.ts'), 'export const answer: number = 42\n')
    await writeFile(join(root, 'apps/deep/consumer/src/index.ts'), 'import { answer } from "@org/shared"\nexport const result = answer + 1\n')

    for (const [packageName, bin] of [['typescript', 'tsc6'], ['@typescript/native', 'tsc']]) {
      for (const project of ['libraries/shared', 'apps/deep/consumer']) {
        const result = typecheck(root, project, packageName, bin)

        assert.equal(result.status, 0, `${packageName}: ${result.stdout}${result.stderr}`)
        assert.deepEqual(await readdir(join(root, project, 'src')), ['index.ts'])
      }
    }

    assert.ok(!(await readdir(root)).includes('dist'))
    assert.equal(await readFile(join(root, 'tsconfig.json'), 'utf8'), editorConfig)

    for (const project of ['shared', 'consumer']) {
      const result = run(root, 'build', project)

      assert.equal(result.status, 0, result.stdout + result.stderr)
    }

    for (const project of ['libraries/shared', 'apps/deep/consumer']) {
      assert.deepEqual((await readdir(join(root, 'dist', project))).sort(), ['index.d.ts', 'index.js'])
    }

    assert.match(await readFile(join(root, 'dist/apps/deep/consumer/index.d.ts'), 'utf8'), /result: number/)

    // Editors must keep checking dependency sources even when built declarations exist.
    await writeFile(join(root, 'libraries/shared/src/index.ts'), 'export const answer: number = "invalid"\n')
    for (const [packageName, bin] of [['typescript', 'tsc6'], ['@typescript/native', 'tsc']]) {
      const result = typecheck(root, 'apps/deep/consumer', packageName, bin)

      assert.notEqual(result.status, 0)
      assert.match(result.stdout + result.stderr, /TS2322/)
    }
  })
}

test('init preserves JSONC comments, settings and aliases, honoring an existing baseUrl', async (t) => {
  const root = await fixture(t)

  await writeFile(join(root, 'tsconfig.base.json'), `{
  // shared compiler settings
  "compilerOptions": {
    "strict": true,
    "baseUrl": "./packages",
    "paths": { "@org/existing": ["./existing/src/index.ts"], },
  },
  "exclude": ["node_modules"],
}\n`)
  const result = run(root, 'init', '@isox-sh/js', join(root, 'packages/test'), '--importPath', '@org/test')

  assert.equal(result.status, 0, result.stderr)
  const source = await readFile(join(root, 'tsconfig.base.json'), 'utf8')

  assert.match(source, /\/\/ shared compiler settings/)
  assert.match(source, /"strict": true/)
  assert.match(source, /"@org\/existing": \[\s*"\.\/existing\/src\/index.ts"\s*\]/)
  assert.match(source, /"\.\/test\/src\/index.ts"/)
  assert.match(source, /"exclude": \["node_modules"\]/)
})

test('project init requires an existing workspace without creating a marker', async (t) => {
  const root = await fixture(t, false)
  const result = run(root, 'init', '@isox-sh/js', 'test')

  assert.equal(result.status, 1)
  assert.match(result.stderr, /No Isox workspace found/)
  assert.deepEqual(await readdir(root), ['node_modules'])
})

test('init rejects root, outside paths, symlink escapes and existing directories', async (t) => {
  const root = await fixture(t)

  await mkdir(join(root, 'existing'))
  await writeFile(join(root, 'existing/keep'), 'keep')
  await symlink(resolve(root, '..'), join(root, 'escape'), 'junction')
  for (const path of ['.', '../outside', join(root, '../absolute-outside'), 'escape/outside', 'existing']) {
    const result = run(root, 'init', '@isox-sh/js', path)

    assert.equal(result.status, 1, path)
    assert.match(result.stderr, /must be inside|already exists/)
  }

  assert.equal(await readFile(join(root, 'existing/keep'), 'utf8'), 'keep')
  assert.deepEqual((await readdir(resolve(root, '..'))).sort(), ['workspace'])
})

test('init rejects conflicting aliases and invalid base configs before creating a project', async (t) => {
  const root = await fixture(t)

  for (const source of [
    '{broken',
    '{ "compilerOptions": [] }',
    '{ "compilerOptions": { "paths": [] } }',
    '{ "compilerOptions": { "baseUrl": false } }',
    '{ "compilerOptions": { "paths": { "@org/test": ["existing.ts"] } } }',
  ]) {
    await writeFile(join(root, 'tsconfig.base.json'), source)
    const result = run(root, 'init', '@isox-sh/js', 'test', '--importPath=@org/test')

    assert.equal(result.status, 1, source)
    assert.match(result.stderr, /Invalid|already exists/)
    assert.equal(await readFile(join(root, 'tsconfig.base.json'), 'utf8'), source)
    assert.ok(!(await readdir(root)).includes('test'))
  }
})

test('init rejects missing arguments, invalid import names, and unavailable initializers', async (t) => {
  const root = await fixture(t)

  await mkdir(join(root, 'node_modules/no-init'))
  await writeFile(join(root, 'node_modules/no-init/package.json'), '{}')
  for (const args of [
    ['--importPath=@org/test'],
    ['@isox-sh/js'],
    ['@isox-sh/js', 'test', '--importPath='],
    ['@isox-sh/js', 'test', '--importPath=@org/*'],
    ['@isox-sh/js', 'test', '--importPath'],
    ['@isox-sh/js', 'test', '--importPath=a', '--importPath=b'],
    ['@isox-sh/js', 'test', 'extra'],
    ['missing-package', 'test'],
    ['no-init', 'test'],
  ]) {
    const result = run(root, 'init', ...args)

    assert.equal(result.status, 1, args.join(' '))
    assert.ok(!(await readdir(root)).includes('test'))
  }
})

test('init rejects duplicate project names even with an outdated discovery cache', async (t) => {
  const root = await fixture(t)

  await mkdir(join(root, 'old'))
  await writeFile(join(root, 'old/project.json'), '{ "name": "test" }')
  await mkdir(join(root, '.isox'))
  await writeFile(join(root, '.isox/workspace.json'), JSON.stringify({
    version: 5,
    projects: {}
  }))
  const result = run(root, 'init', '@isox-sh/js', 'test')

  assert.equal(result.status, 1)
  assert.match(result.stderr, /Project test already exists/)
  assert.ok(!(await readdir(root)).includes('test'))
})

test('initializers resolve plugins whose exports hide package.json', async t => {
  const root = await fixture(t)
  const directory = join(root, 'node_modules/private-plugin')

  await mkdir(directory)
  await writeFile(join(directory, 'package.json'), JSON.stringify({
    exports: { '.': './public.cjs' },
    init: './init.cjs'
  }))
  await writeFile(join(directory, 'init.cjs'), `module.exports = async (_, context) => {
    await require('node:fs/promises').mkdir(context.projectRoot)
  }`)
  const result = run(root, 'init', 'private-plugin', 'created')

  assert.equal(result.status, 0, result.stderr)
  assert.ok((await readdir(root)).includes('created'))
})

test('initialization refuses a symlinked base config without modifying its target', async t => {
  const root = await fixture(t)
  const outside = join(root, '../outside.json')

  await writeFile(outside, '{}')
  await symlink(outside, join(root, 'tsconfig.base.json'))
  const result = run(root, 'init', '@isox-sh/js', 'created', '--importPath=@org/created')

  assert.equal(result.status, 1)
  assert.match(result.stderr, /symlink/)
  assert.equal(await readFile(outside, 'utf8'), '{}')
  assert.ok(!(await readdir(root)).includes('created'))
})
