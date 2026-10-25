import assert from 'node:assert/strict'
import { mkdir, mkdtemp, readdir, readFile, realpath, rm, symlink, writeFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { dirname, join } from 'node:path'

import { findWorkspaceRoot, json, readJson, writeJson } from '@isox-sh/core'
import { test } from 'vitest'

import { createWorkspace } from '../../../dist/e2e/index.js'

const require = createRequire(import.meta.url)

async function owner(t) {
  const repository = await findWorkspaceRoot(import.meta.dirname)

  await mkdir(join(repository, 'tmp'), { recursive: true })
  const root = await mkdtemp(join(repository, 'tmp/e2e-owner-'))

  t.onTestFinished(() => rm(root, {
    recursive: true,
    force: true
  }))
  await writeJson('isox.json', {}, { projectRoot: root })
  await mkdir(join(root, 'tests/nested'), { recursive: true })

  return root
}

async function plugin(root, name, directory) {
  const path = join(root, directory)

  await mkdir(path, { recursive: true })
  await writeJson('package.json', {
    name,
    version: '1.0.0',
    executors: './executors.json'
  }, { projectRoot: path })
  await writeJson('executors.json', { executors: { build: { implementation: './build.cjs' } } }, { projectRoot: path })
  await writeFile(join(path, 'build.cjs'), `module.exports = (options, context) => {
    require('node:fs').writeFileSync(require('node:path').join(context.projectRoot, options.output), 'built')
    return { success: true }
  }`)

  return path
}

test('detects the caller workspace, supplies the CLI, and cleans up only its own fixture', async t => {
  const root = await owner(t)
  const workspace = await createWorkspace({ startDirectory: join(root, 'tests/nested') })

  t.onTestFinished(workspace.cleanup)
  assert.equal(dirname(workspace.root), join(root, 'tmp'))
  assert.ok(!(await readdir(workspace.root)).includes('isox.json'))
  assert.deepEqual(await readJson('package.json', { projectRoot: workspace.root }), {
    name: 'isox-e2e-workspace',
    private: true,
  })
  await workspace.runIsox(['init'])
  assert.deepEqual(await readJson('isox.json', { projectRoot: workspace.root }), { version: workspace.version })
  await writeFile(join(root, 'tmp/keep'), 'keep')
  await workspace.cleanup()
  await workspace.cleanup()
  assert.deepEqual(await readdir(join(root, 'tmp')), ['keep'])
})

test('links arbitrary scoped and unscoped plugin directories and runs their real executors', async t => {
  const root = await owner(t)
  const scoped = await plugin(root, '@example/compiler', 'tools/custom compiler')
  const unscoped = await plugin(root, 'custom-plugin', 'other/plugin')

  // The plugin must keep resolving its own installed dependencies from its source directory.
  await mkdir(join(scoped, 'node_modules/fixture-dependency'), { recursive: true })
  await writeFile(join(scoped, 'node_modules/fixture-dependency/index.js'), 'module.exports = "dependency output"')
  await writeFile(join(scoped, 'build.cjs'), `module.exports = (options, context) => {
    require('node:fs').writeFileSync(require('node:path').join(context.projectRoot, options.output), require('fixture-dependency'))
    return { success: true }
  }`)
  const workspace = await createWorkspace({
    startDirectory: root,
    plugins: {
      '@example/compiler': 'tools/custom compiler',
      'custom-plugin': unscoped
    },
  })

  t.onTestFinished(workspace.cleanup)
  assert.equal(await realpath(join(workspace.root, 'node_modules/@example/compiler')), await realpath(scoped))
  assert.equal(await realpath(join(workspace.root, 'node_modules/custom-plugin')), await realpath(unscoped))
  await workspace.runIsox(['init'])
  await writeJson('project.json', {
    name: 'external',
    targets: {
      build: {
        executor: '@example/compiler:build',
        options: { output: 'scoped.txt' }
      },
      other: {
        executor: 'custom-plugin:build',
        options: { output: 'unscoped.txt' }
      },
    },
  }, { projectRoot: workspace.root })
  await workspace.runIsox(['build', 'external'])
  await workspace.runIsox(['other', 'external'])
  assert.equal(await readFile(join(workspace.root, 'scoped.txt'), 'utf8'), 'dependency output')
  assert.equal(await readFile(join(workspace.root, 'unscoped.txt'), 'utf8'), 'built')
})

test('accepts a custom CLI directory and invokes its declared binary without shell interpolation', async t => {
  const root = await owner(t)
  const cliRoot = join(root, 'custom cli')

  await mkdir(join(cliRoot, 'node_modules/@isox-sh'), { recursive: true })
  await symlink(dirname(require.resolve('@isox-sh/core/package.json')), join(cliRoot, 'node_modules/@isox-sh/core'), 'junction')
  await writeJson('package.json', {
    name: 'isox',
    version: '9.9.9',
    bin: './cli.cjs'
  }, { projectRoot: cliRoot })
  await writeFile(join(cliRoot, 'cli.cjs'), 'process.stdout.write(require("@isox-sh/core").json(process.argv.slice(2)))')
  const workspace = await createWorkspace({
    startDirectory: root,
    cliDirectory: 'custom cli'
  })

  t.onTestFinished(workspace.cleanup)
  assert.equal(workspace.version, '9.9.9')
  const args = ['a b', '$(not-a-command)', '"quoted"']

  assert.equal((await workspace.runIsox(args)).stdout, json(args))
})

test('rejects unsafe names, duplicate built-ins, mismatched packages, and missing directories before creating fixtures', async t => {
  const root = await owner(t)

  await plugin(root, '@example/plugin', 'plugin')
  for (const plugins of [
    { '../escape': 'plugin' },
    { '@scope/../escape': 'plugin' },
    { isox: 'plugin' },
    { '@isox-sh/core': 'plugin' },
    { '@wrong/name': 'plugin' },
    { '@example/plugin': 'missing' },
    { '@example/plugin': '' },
  ]) {
    await assert.rejects(createWorkspace({
      startDirectory: root,
      plugins
    }))
  }

  assert.ok(!(await readdir(root)).includes('tmp'))
})

test('failed commands report stdout, stderr, cwd, and the underlying exit code', async t => {
  const root = await owner(t)
  const workspace = await createWorkspace({ startDirectory: root })

  t.onTestFinished(workspace.cleanup)
  await assert.rejects(workspace.runNode(['--eval', 'console.log("output"); console.error("diagnostic"); process.exit(7)']), error => {
    assert.ok(error.message.includes(workspace.root))
    assert.match(error.message, /output/)
    assert.match(error.message, /diagnostic/)
    assert.equal(error.cause.code, 7)

    return true
  })
})

test('enforces a configurable command timeout', async t => {
  const root = await owner(t)
  const workspace = await createWorkspace({
    startDirectory: root,
    timeout: 100
  })

  t.onTestFinished(workspace.cleanup)
  await assert.rejects(workspace.runNode(['--eval', 'setInterval(() => {}, 1000)']), error => error.cause.killed === true)
  for (const timeout of [0, -1, NaN, Infinity]) {
    await assert.rejects(createWorkspace({
      startDirectory: root,
      timeout
    }), /timeout must be a positive/)
  }
})

test('cleans up if workspace setup fails', async t => {
  const root = await owner(t)

  await assert.rejects(createWorkspace({
    startDirectory: root,
    logger: {
      success() {
        throw new Error('setup failed')
      },
    },
  }), /setup failed/)
  assert.deepEqual(await readdir(join(root, 'tmp')), [])
})

test('captures large output and accepts a custom buffer limit', async t => {
  const root = await owner(t)
  const workspace = await createWorkspace({ startDirectory: root })

  t.onTestFinished(workspace.cleanup)
  const { stdout } = await workspace.runNode(['--eval', "process.stdout.write('x'.repeat(2 * 1024 * 1024))"])

  assert.equal(stdout.length, 2 * 1024 * 1024)
  for (const maxBuffer of [0, -1, 1.5, NaN, Infinity]) {
    await assert.rejects(createWorkspace({
      startDirectory: root,
      maxBuffer
    }), /maxBuffer/)
  }
})
