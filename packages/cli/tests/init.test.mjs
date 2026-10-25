import { createRequire } from 'node:module'

import { test } from 'vitest'

const require = createRequire(import.meta.url)
const __dirname = import.meta.dirname
const assert = require('node:assert/strict')
const { spawnSync } = require('node:child_process')
const { mkdir, mkdtemp, readFile, readdir, rm, writeFile } = require('node:fs/promises')
const { tmpdir } = require('node:os')
const { join, resolve } = require('node:path')
const { version } = require('../package.json')

const cliPath = resolve(__dirname, '../../../dist/cli/index.js')

async function fixture(t) {
  const root = await mkdtemp(join(tmpdir(), 'isox-init-'))
  t.onTestFinished(() => rm(root, { recursive: true, force: true }))
  return root
}

function run(root, ...args) {
  return spawnSync(process.execPath, [cliPath, ...args], { cwd: root, encoding: 'utf8' })
}

test('init uses the CLI package version and creates a marker that other actions recognize', async (t) => {
  const root = await fixture(t)
  await writeFile(join(root, 'package.json'), JSON.stringify({ name: 'other-project', version: '99.0.0' }))
  const result = run(root, 'init')
  assert.equal(result.status, 0, result.stderr)
  assert.match(result.stdout, /Created .*isox.json/)
  assert.deepEqual(JSON.parse(await readFile(join(root, 'isox.json'), 'utf8')), { version })
  assert.deepEqual((await readdir(root)).sort(), ['isox.json', 'package.json'])

  const reset = run(root, 'reset')
  assert.equal(reset.status, 0, reset.stderr)
})

test('init includes Nx settings and the plugin dependency when nx.json exists in the root', async (t) => {
  const root = await fixture(t)
  await writeFile(join(root, 'nx.json'), '{}\n')
  const result = run(root, 'init')
  assert.equal(result.status, 0, result.stderr)
  assert.deepEqual(JSON.parse(await readFile(join(root, 'isox.json'), 'utf8')), { version, nx: { executors: ['@nx'] } })
  assert.equal(await readFile(join(root, 'nx.json'), 'utf8'), '{}\n')
  assert.deepEqual(JSON.parse(await readFile(join(root, 'package.json'), 'utf8')), {
    devDependencies: { '@isox-sh/nx': version },
  })
  assert.match(result.stdout, /package\.json/)
})

test('Nx init preserves existing package metadata and plugin versions in either dependency section', async (t) => {
  const root = await fixture(t)
  await writeFile(join(root, 'nx.json'), '{}')
  for (const field of ['dependencies', 'devDependencies']) {
    const pkg = { name: 'demo', scripts: { build: 'custom' }, [field]: { '@isox-sh/nx': 'workspace:*', nx: '^23' } }
    const source = JSON.stringify(pkg)
    await writeFile(join(root, 'package.json'), source)
    const result = run(root, 'init')
    assert.equal(result.status, 0, result.stderr)
    assert.equal(await readFile(join(root, 'package.json'), 'utf8'), source)
    await rm(join(root, 'isox.json'))
  }
})

test('Nx init leaves existing workspaces untouched and rolls back its marker if package.json is invalid', async (t) => {
  const root = await fixture(t)
  await writeFile(join(root, 'nx.json'), '{}')
  await writeFile(join(root, 'isox.json'), 'existing')
  await writeFile(join(root, 'package.json'), '{}')
  assert.equal(run(root, 'init').status, 1)
  assert.equal(await readFile(join(root, 'package.json'), 'utf8'), '{}')
  await rm(join(root, 'isox.json'))
  for (const source of ['{broken', '[]', '{"devDependencies":null}']) {
    await writeFile(join(root, 'package.json'), source)
    const result = run(root, 'init')
    assert.equal(result.status, 1)
    assert.match(result.stderr, /Invalid/)
    assert.equal(await readFile(join(root, 'package.json'), 'utf8'), source)
    assert.ok(!(await readdir(root)).includes('isox.json'))
  }
})

test('init ignores nx.json in parent or nested directories', async (t) => {
  const root = await fixture(t)
  const nested = join(root, 'nested')
  await mkdir(join(nested, 'child'), { recursive: true })
  await writeFile(join(root, 'nx.json'), '{}')
  await writeFile(join(nested, 'child', 'nx.json'), '{}')
  const result = run(nested, 'init')
  assert.equal(result.status, 0, result.stderr)
  assert.deepEqual(JSON.parse(await readFile(join(nested, 'isox.json'), 'utf8')), { version })
})

test('init ignores a directory named nx.json', async (t) => {
  const root = await fixture(t)
  await mkdir(join(root, 'nx.json'))
  const result = run(root, 'init')
  assert.equal(result.status, 0, result.stderr)
  assert.deepEqual(JSON.parse(await readFile(join(root, 'isox.json'), 'utf8')), { version })
})

test('init preserves existing files, including malformed configuration', async (t) => {
  const root = await fixture(t)
  for (const content of ['{ "version": 42, "custom": true }\n', '{broken']) {
    await writeFile(join(root, 'isox.json'), content)
    const result = run(root, 'init')
    assert.equal(result.status, 1)
    assert.match(result.stderr, /isox.json already exists/)
    assert.equal(await readFile(join(root, 'isox.json'), 'utf8'), content)
  }
})

test('init help and invalid arguments do not create a workspace', async (t) => {
  const root = await fixture(t)
  const help = run(root, 'init', '--help')
  assert.equal(help.status, 0, help.stderr)
  assert.match(help.stdout, /init/)
  for (const args of [['init', 'extra'], ['init', '--unknown']]) {
    const result = run(root, ...args)
    assert.equal(result.status, 1)
    assert.match(result.stderr, /requires both a package and a path|Unknown option/)
  }
  assert.deepEqual(await readdir(root), [])
})
