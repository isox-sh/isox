import { createRequire } from 'node:module'

import { test } from 'vitest'

const require = createRequire(import.meta.url)
const __dirname = import.meta.dirname
const assert = require('node:assert/strict')
const { spawnSync } = require('node:child_process')
const { mkdtemp, mkdir, readFile, writeFile, rm, stat } = require('node:fs/promises')
const { tmpdir } = require('node:os')
const { dirname, join, resolve } = require('node:path')

const cliPath = resolve(__dirname, '../../../dist/cli/index.js')

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

test('reset removes the whole cache from nested directories and the next CLI run recreates it', async (t) => {
  const { root, write, cacheFile } = await fixture(t)
  const project = {
    name: 'demo',
    targets: {
      build: {
        executor: 'fixture-plugin:build',
        options: { success: true }
      }
    },
  }

  await write('apps/demo/project.json', project)
  // Running and selecting explicit targets must not invoke dependency analysis.
  await write('apps/demo/tsconfig.json', '{broken')
  await write('apps/demo/package.json', '{broken')
  await write('node_modules/fixture-plugin/package.json', { executors: './executors.json' })
  await write('node_modules/fixture-plugin/executors.json', {
    executors: { build: { implementation: './executor.cjs' } },
  })
  await write('node_modules/fixture-plugin/executor.cjs', 'module.exports = options => ({ success: options.success })')
  const cwd = join(root, 'apps/demo')
  const run = (...args) => spawnSync(process.execPath, [cliPath, ...args], {
    cwd,
    encoding: 'utf8'
  })

  let result = run('run', 'demo:build')

  assert.equal(result.status, 0, result.stderr)
  assert.ok((await stat(cacheFile)).isFile())
  assert.equal(run('plan', '--all', '--target', 'build').status, 0)
  project.targets.build.options.success = false
  await write('apps/demo/project.json', project)
  result = run('run', 'demo:build')
  assert.equal(result.status, 0, result.stderr)
  await write('.isox/other/nested-file', 'cached data')

  result = run('reset')
  assert.equal(result.status, 0, result.stderr)
  assert.match(result.stdout, /Workspace cache cleared/)
  await assert.rejects(stat(join(root, '.isox')), { code: 'ENOENT' })
  assert.ok((await stat(join(root, 'isox.json'))).isFile())
  assert.equal(run('reset').status, 0)

  result = run('run', 'demo:build')
  assert.equal(result.status, 1)
  assert.match(result.stderr, /Task failed for demo/)
  const recreated = JSON.parse(await readFile(cacheFile, 'utf8'))

  assert.equal(recreated.projects.demo.targets.build.options.success, false)
})

test('reset works with a corrupt cache and rejects locations without a workspace marker', async (t) => {
  const { root, write } = await fixture(t)

  await write('.isox/workspace.json', '{broken')
  const reset = spawnSync(process.execPath, [cliPath, 'reset'], {
    cwd: root,
    encoding: 'utf8'
  })

  assert.equal(reset.status, 0, reset.stderr)
  await assert.rejects(stat(join(root, '.isox')), { code: 'ENOENT' })
  await write('.isox/keep', 'data')
  await rm(join(root, 'isox.json'))
  const result = spawnSync(process.execPath, [cliPath, 'reset'], {
    cwd: root,
    encoding: 'utf8'
  })

  assert.equal(result.status, 1)
  assert.match(result.stderr, /No Isox workspace found/)
  assert.equal(await readFile(join(root, '.isox/keep'), 'utf8'), 'data')
})
