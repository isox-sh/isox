import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { mkdir, mkdtemp, readFile, rm, symlink, writeFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'

import { test } from 'vitest'

const require = createRequire(import.meta.url)
const { default: add } = require('../../../dist/eslint/generators/add')
const { createLogger, parseWorkspace } = require('../../../dist/core')
const cli = resolve(import.meta.dirname, '../../../dist/cli/index.js')

async function fixture(t, target) {
  const root = await mkdtemp(join(tmpdir(), 'isox-eslint-add-'))
  const projectRoot = join(root, 'apps/demo')
  const logger = createLogger({ level: -Infinity })
  const context = {
    workspaceRoot: root,
    projectRoot,
    projectName: 'demo',
    logger
  }
  const write = async (file, value) => {
    await mkdir(dirname(join(root, file)), { recursive: true })
    await writeFile(join(root, file), JSON.stringify(value))
  }

  const read = async file => JSON.parse(await readFile(join(root, file), 'utf8'))

  t.onTestFinished(() => rm(root, {
    recursive: true,
    force: true
  }))
  await write('isox.json', {
    version: '1',
    custom: { owner: 'team' }
  })
  await write('apps/demo/project.json', {
    name: 'demo',
    tags: ['library'],
    targets: {
      build: { executor: 'js:tsc' },
      ...(target ? { lint: target } : {}),
    }
  })

  return {
    root,
    projectRoot,
    context,
    write,
    read
  }
}

test('adds the shorthand lint target once and preserves metadata', async t => {
  const f = await fixture(t)

  await f.write('package.json', {
    devDependencies: {
      eslint: '^10.0.0',
      'typescript-eslint': '^8.0.0',
    }
  })
  await add({}, f.context)
  const manifest = await readFile(join(f.root, 'package.json'), 'utf8')
  const deps = (await f.read('package.json')).devDependencies

  assert.equal(deps.eslint, '^10.0.0')
  assert.equal(deps['typescript-eslint'], '^8.0.0')
  for (const name of ['@isox-sh/eslint', '@eslint/js', 'typescript', 'globals']) {
    assert.ok(deps[name], name)
  }

  assert.match(await readFile(join(f.root, 'eslint.config.mjs'), 'utf8'), /tseslint.configs.recommended/)
  assert.deepEqual(await f.read('apps/demo/project.json'), {
    name: 'demo',
    tags: ['library'],
    targets: {
      build: { executor: 'js:tsc' },
      lint: { executor: 'eslint:lint' },
    }
  })
  assert.deepEqual(await f.read('isox.json'), {
    version: '1',
    custom: { owner: 'team' },
  })
  const project = await readFile(join(f.projectRoot, 'project.json'), 'utf8')
  const settings = await readFile(join(f.root, 'isox.json'), 'utf8')

  await add({}, f.context)
  assert.equal(await readFile(join(f.projectRoot, 'project.json'), 'utf8'), project)
  assert.equal(await readFile(join(f.root, 'isox.json'), 'utf8'), settings)
  assert.equal(await readFile(join(f.root, 'package.json'), 'utf8'), manifest)
  await assert.rejects(readFile(join(f.projectRoot, 'package.json')), { code: 'ENOENT' })
})

test('existing scoped targets and explicit workspace defaults are preserved', async t => {
  const target = {
    executor: '@isox-sh/eslint:lint',
    cache: false,
    options: { configFile: 'custom.ts' },
    configurations: { acc: { configFile: 'acc.ts' } }
  }
  const f = await fixture(t, target)
  const defaults = {
    cache: false,
    outputs: ['coverage'],
    inputs: ['tests/**']
  }

  await f.write('isox.json', { targetDefaults: { '@isox-sh/eslint:lint': defaults } })
  await add({}, f.context)
  assert.deepEqual((await f.read('apps/demo/project.json')).targets.lint, target)
  assert.deepEqual((await f.read('isox.json')).targetDefaults, { '@isox-sh/eslint:lint': defaults })
})

test('a different lint executor fails without modifying either file', async t => {
  const f = await fixture(t, {
    executor: 'core:run-command',
    options: { command: 'custom' }
  })
  const before = await f.read('apps/demo/project.json')
  const settings = await f.read('isox.json')

  await assert.rejects(add({}, f.context), /different lint target/)
  assert.deepEqual(await f.read('apps/demo/project.json'), before)
  assert.deepEqual(await f.read('isox.json'), settings)
  await assert.rejects(readFile(join(f.root, 'eslint.config.mjs')), { code: 'ENOENT' })
  await assert.rejects(readFile(join(f.root, 'package.json')), { code: 'ENOENT' })
})

for (const extension of ['js', 'mjs', 'cjs', 'ts', 'mts', 'cts']) {
  test(`preserves an existing root eslint.config.${extension}`, async t => {
    const f = await fixture(t)
    const name = `eslint.config.${extension}`
    const source = '// custom config\nexport default []\n'

    await writeFile(join(f.root, name), source)
    await add({}, f.context)
    assert.equal(await readFile(join(f.root, name), 'utf8'), source)
    assert.deepEqual(Object.keys((await f.read('package.json')).devDependencies), ['@isox-sh/eslint', 'eslint'])

    if (extension !== 'mjs') {
      await assert.rejects(readFile(join(f.root, 'eslint.config.mjs')), { code: 'ENOENT' })
    }
  })
}

test('an existing lint target still repairs missing workspace setup and repeats without changing files', async t => {
  const f = await fixture(t, {
    executor: 'eslint:lint',
    options: { fix: true }
  })

  await add({}, f.context)
  const config = await readFile(join(f.root, 'eslint.config.mjs'), 'utf8')
  const manifest = await readFile(join(f.root, 'package.json'), 'utf8')

  await add({}, f.context)
  assert.equal(await readFile(join(f.root, 'eslint.config.mjs'), 'utf8'), config)
  assert.equal(await readFile(join(f.root, 'package.json'), 'utf8'), manifest)
  assert.deepEqual((await f.read('apps/demo/project.json')).targets.lint.options, { fix: true })
})

test('generated config lints TypeScript and ignores generated output', async t => {
  const f = await fixture(t)
  const { resolvePackageJson } = require('../../../dist/core')

  await add({}, f.context)
  for (const name of ['eslint', '@eslint/js', 'globals', 'typescript-eslint', 'typescript', '@isox-sh/eslint']) {
    const link = join(f.root, 'node_modules', name)

    await mkdir(dirname(link), { recursive: true })
    await symlink(dirname(resolvePackageJson(name, resolve(import.meta.dirname, '../../..'))), link, 'junction')
  }

  await mkdir(join(f.projectRoot, 'src'))
  await mkdir(join(f.projectRoot, 'dist'))
  await writeFile(join(f.projectRoot, 'src/index.ts'), 'export const answer: number = 42\n')
  await writeFile(join(f.projectRoot, 'dist/broken.ts'), 'this is invalid syntax !!!')
  const run = () => spawnSync(process.execPath, [cli, 'lint', 'demo'], {
    cwd: f.root,
    encoding: 'utf8'
  })
  const clean = run()

  assert.equal(clean.status, 0, clean.stdout + clean.stderr)
  await writeFile(join(f.projectRoot, 'src/index.ts'), 'const unused: number = 42\n')
  const invalid = run()

  assert.equal(invalid.status, 1, invalid.stdout + invalid.stderr)
  assert.match(invalid.stdout + invalid.stderr, /no-unused-vars/)
})

test('the CLI loads the packaged generator by project name and invalidates stale definitions', async t => {
  const f = await fixture(t)
  const link = join(f.root, 'node_modules/@isox-sh/eslint')

  await mkdir(dirname(link), { recursive: true })
  await symlink(resolve(import.meta.dirname, '../../../dist/eslint'), link, process.platform === 'win32' ? 'junction' : 'dir')
  await parseWorkspace(f.root, { logger: f.context.logger })
  const result = spawnSync(process.execPath, [cli, 'add', '@isox-sh/eslint', 'demo'], {
    cwd: f.root,
    encoding: 'utf8'
  })

  assert.equal(result.status, 0, result.stderr)
  assert.ok((await f.read('package.json')).devDependencies['@isox-sh/eslint'])
  await assert.rejects(readFile(join(f.root, '.isox/workspace.json')), { code: 'ENOENT' })
  const workspace = await parseWorkspace(f.root, { logger: f.context.logger })

  assert.deepEqual(workspace.projects.demo.targets.lint, {
    executor: 'eslint:lint'
  })
})
