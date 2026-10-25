import { createRequire } from 'node:module'

import { test } from 'vitest'

const require = createRequire(import.meta.url)
const assert = require('node:assert/strict')
const { mkdtemp, mkdir, writeFile, rm } = require('node:fs/promises')
const { tmpdir } = require('node:os')
const { basename, dirname, join } = require('node:path')
const { createLogger, findWorkspaceRoot, LogLevels, parseWorkspace, runExecutor } = require('../../../dist/core')

async function fixture(t) {
  const root = await mkdtemp(join(tmpdir(), 'isox-test-'))
  t.onTestFinished(() => rm(root, { recursive: true, force: true }))
  const write = async (file, content) => {
    const path = join(root, file)
    await mkdir(dirname(path), { recursive: true })
    await writeFile(path, typeof content === 'string' ? content : JSON.stringify(content))
  }
  return { root, write }
}

async function executorFixture(t, source, manifestKey = 'executors') {
  const fixtureData = await fixture(t)
  const { root, write } = fixtureData
  await write('isox.json', {})
  await write('apps/demo/project.json', {
    name: 'demo',
    targets: { build: { executor: '@fixture/plugin:build', options: { answer: 42 } } },
  })
  await write('node_modules/@fixture/plugin/package.json', {
    name: '@fixture/plugin',
    [manifestKey]: './config/registry.json',
  })
  await write('node_modules/@fixture/plugin/config/registry.json', {
    [manifestKey]: { build: { implementation: '../executor.cjs' } },
  })
  await write('node_modules/@fixture/plugin/executor.cjs', source)
  return { ...fixtureData, workspace: await parseWorkspace(root) }
}

test('prefers first-party shorthand, falls back to third-party packages, and preserves manifest errors', async (t) => {
  const { root, write, workspace } = await executorFixture(t, 'module.exports = () => ({ success: true })')
  workspace.projects.demo.targets.build.executor = 'js:build'
  await write('node_modules/@isox-sh/js/package.json', { executors: './executors.json' })
  await write('node_modules/@isox-sh/js/executors.json', { executors: { build: { implementation: './build.cjs' } } })
  await write('node_modules/@isox-sh/js/build.cjs', 'module.exports = () => ({ success: true })')
  await runExecutor(workspace, 'demo', 'build', root)

  await write('node_modules/js/package.json', { executors: './executors.json' })
  await write('node_modules/js/executors.json', { executors: { build: { implementation: './build.cjs' } } })
  await write('node_modules/js/build.cjs', 'module.exports = () => ({ success: false })')
  await runExecutor(workspace, 'demo', 'build', root)
  workspace.projects.demo.targets.build.executor = 'js:missing'
  await assert.rejects(runExecutor(workspace, 'demo', 'build', root), /Executor missing not found in @isox-sh\/js/)

  workspace.projects.demo.targets.build.executor = '@isox-sh/js:build'
  await runExecutor(workspace, 'demo', 'build', root)

  await write('node_modules/third-party/package.json', { executors: '../@isox-sh/js/executors.json' })
  workspace.projects.demo.targets.build.executor = 'third-party:build'
  await runExecutor(workspace, 'demo', 'build', root)

  await write('node_modules/broken/package.json', { executors: '../@isox-sh/js/executors.json' })
  await write('node_modules/@isox-sh/broken/package.json', { name: '@isox-sh/broken' })
  workspace.projects.demo.targets.build.executor = 'broken:build'
  await assert.rejects(runExecutor(workspace, 'demo', 'build', root), /Package @isox-sh\/broken does not define an executors manifest/)
})

test('finds the workspace marker from the root and nested directories', async (t) => {
  const { root, write } = await fixture(t)
  await write('isox.json', {})
  await write('apps/demo/src/index.ts', '')
  assert.equal(await findWorkspaceRoot(root), root)
  assert.equal(await findWorkspaceRoot(join(root, 'apps/demo/src')), root)
})

test('uses the nearest workspace marker', async (t) => {
  const { root, write } = await fixture(t)
  await write('isox.json', {})
  await write('nested/isox.json', {})
  await write('nested/apps/demo/project.json', {})
  assert.equal(await findWorkspaceRoot(join(root, 'nested/apps/demo')), join(root, 'nested'))
})

test('ignores directories named isox.json', async (t) => {
  const { root, write } = await fixture(t)
  await write('isox.json', {})
  await mkdir(join(root, 'nested/isox.json'), { recursive: true })
  assert.equal(await findWorkspaceRoot(join(root, 'nested')), root)
})

test('reports a missing workspace marker in the core API', async (t) => {
  const { root, write } = await fixture(t)
  await write('project.json', { name: 'demo' })
  await assert.rejects(findWorkspaceRoot(root), /No Isox workspace found.*Add isox.json/)
})

test('discovers nested and root projects, derives names and roots, and ignores dependencies', async (t) => {
  const { root, write } = await fixture(t)
  await write('project.json', {})
  await write('apps/first/project.json', { tags: ['library'] })
  await write('apps/second/project.json', { name: 'named', dependencies: ['first'] })
  await write('node_modules/ignored/project.json', { name: 'ignored' })
  await write('tmp/isox-e2e-fixture/packages/test/project.json', { name: 'ignored' })
  const { projects } = await parseWorkspace(root)
  assert.deepEqual(Object.keys(projects).sort(), ['first', 'named', basename(root)].sort())
  assert.equal(projects.first.root, 'apps/first')
  assert.equal(projects.first.name, 'first')
  assert.deepEqual(projects.first.tags, ['library'])
  assert.equal(projects[basename(root)].root, '.')
  assert.deepEqual(projects.named.dependencies, ['first'])
})

test('rejects duplicate project names', async (t) => {
  const { root, write } = await fixture(t)
  await write('apps/first/project.json', { name: 'duplicate' })
  await write('apps/second/project.json', { name: 'duplicate' })
  await assert.rejects(parseWorkspace(root), /Duplicate project name duplicate/)
})

test('rejects invalid project configurations', async (t) => {
  const { root, write } = await fixture(t)
  for (const content of ['{broken', 'null', '[]', '{"name":42}']) {
    await write('project.json', content)
    await assert.rejects(parseWorkspace(root), /Invalid project configuration in project\.json/)
  }
})

test('malformed project JSON identifies its file and preserves the parse error', async (t) => {
  const { root, write } = await fixture(t)
  await write('apps/broken/project.json', '{broken')
  await assert.rejects(parseWorkspace(root), error => {
    assert.ok(error instanceof SyntaxError)
    assert.match(error.message, /Invalid project configuration in apps\/broken\/project\.json: invalid JSON/)
    assert.ok(error.cause instanceof SyntaxError)
    return true
  })
})

for (const [label, source, key] of [
  ['synchronous result', 'module.exports = () => ({ success: true })', 'executors'],
  ['promise result', 'exports.default = async () => ({ success: true })', 'executors'],
  ['async iterable', `module.exports = async function* () {
    yield { success: true }
    yield { success: true }
  }`, 'executors'],
]) {
  test(`executes a plugin with a ${label}`, async (t) => {
    const { root, workspace } = await executorFixture(t, source, key)
    await runExecutor(workspace, 'demo', 'build', root)
  })
}

for (const [label, source] of [
  ['failed result', 'module.exports = async () => ({ success: false })'],
  ['failed stream', `module.exports = async function* () {
    yield { success: true }
    yield { success: false }
  }`],
  ['empty stream', 'module.exports = async function* () {}'],
  ['missing result', 'module.exports = async () => undefined'],
]) {
  test(`rejects a ${label}`, async (t) => {
    const { root, workspace } = await executorFixture(t, source)
    await assert.rejects(
      runExecutor(workspace, 'demo', 'build', root),
      /Task failed for demo/,
    )
  })
}

test('reports malformed and missing executors', async (t) => {
  const { root, workspace } = await executorFixture(t, 'module.exports = () => ({ success: true })')
  workspace.projects.demo.targets.build.executor = 'invalid'
  await assert.rejects(runExecutor(workspace, 'demo', 'build', root), /Invalid executor format/)
  workspace.projects.demo.targets.build.executor = '@fixture/plugin:missing'
  await assert.rejects(
    runExecutor(workspace, 'demo', 'build', root),
    /Executor missing not found/,
  )
})

test('executor uses an injected logger and enables verbose context at debug level', async (t) => {
  const { root, workspace } = await executorFixture(t, `
    module.exports = async (options, context) => {
      require('node:assert/strict').equal(context.verbose, true)
      return { success: !options.fail }
    }
  `)
  const logs = []
  const logger = createLogger({
    level: LogLevels.debug,
    reporters: [{ log: entry => logs.push(entry) }],
  })
  await runExecutor(workspace, 'demo', 'build', root, logger)
  assert.deepEqual(logs.map(entry => entry.type), ['debug', 'info', 'success'])
  logs.length = 0
  workspace.projects.demo.targets.build.options = { fail: true }
  await assert.rejects(
    runExecutor(workspace, 'demo', 'build', root, logger),
    /Task failed for demo/,
  )
  assert.deepEqual(logs.map(entry => entry.type), ['debug', 'info'])
})

test('native executors reject builders manifests', async (t) => {
  const { root, workspace } = await executorFixture(t, 'module.exports = () => ({ success: true })', 'builders')
  await assert.rejects(runExecutor(workspace, 'demo', 'build', root), /does not define an executors manifest/)
})

test('runner rejects missing projects and commands in the public API', async (t) => {
  const { root, workspace } = await executorFixture(t, 'module.exports = () => ({ success: true })')
  await assert.rejects(runExecutor(workspace, 'missing', 'build', root), /Project missing not found/)
  await assert.rejects(runExecutor(workspace, 'demo', 'toString', root), /Command toString not found/)
})

test('selected Nx executors report how to install the optional plugin', async (t) => {
  const { root, write, workspace } = await executorFixture(t, 'throw new Error("must not load")', 'executors')
  await write('isox.json', { nx: { executors: ['@fixture'] } })
  await assert.rejects(runExecutor(workspace, 'demo', 'build', root), /Nx executors require @isox-sh\/nx.*npm install --save-dev @isox-sh\/nx/)
})

test('Nx selection loads the workspace plugin and preserves unscoped nx executor resolution', async (t) => {
  const { root, write, workspace } = await executorFixture(t, 'throw new Error("must not load")', 'executors')
  await write('isox.json', { nx: { executors: ['nx'] } })
  workspace.projects.demo.targets.build.executor = 'nx:build'
  await write('node_modules/nx/package.json', { name: 'nx' })
  await write('node_modules/@isox-sh/nx/package.json', { main: './index.cjs' })
  await write('node_modules/@isox-sh/nx/index.cjs', `exports.runNxExecutor = (options, context, packagePath) => {
    const assert = require('node:assert/strict')
    assert.deepEqual(options, { answer: 42 })
    assert.equal(context.command.executor, 'nx:build')
    assert.equal(context.projectName, 'demo')
    assert.equal(packagePath, require('node:fs').realpathSync(require('node:path').join(context.workspaceRoot, 'node_modules/nx/package.json')))
    return { success: true }
  }`)
  await runExecutor(workspace, 'demo', 'build', root)
})

for (const [label, source, expected] of [
  ['broken dependency', 'require("missing-adapter-dependency")', /Cannot find module 'missing-adapter-dependency'/],
  ['missing export', 'module.exports = {}', /does not export runNxExecutor/],
]) {
  test(`Nx plugin reports a ${label} without masking it as an installation error`, async (t) => {
    const { root, write, workspace } = await executorFixture(t, 'throw new Error("must not load")', 'executors')
    await write('isox.json', { nx: { executors: ['@fixture'] } })
    await write('node_modules/@isox-sh/nx/package.json', { main: './index.cjs' })
    await write('node_modules/@isox-sh/nx/index.cjs', source)
    await assert.rejects(runExecutor(workspace, 'demo', 'build', root), expected)
  })
}

test('native commands do not load the installed Nx plugin', async (t) => {
  const { root, write, workspace } = await executorFixture(t, 'module.exports = () => ({ success: true })')
  await write('isox.json', { nx: { executors: ['@nx'] } })
  await write('node_modules/@isox-sh/nx/package.json', { main: './index.cjs' })
  await write('node_modules/@isox-sh/nx/index.cjs', 'throw new Error("Nx plugin must not load")')
  await runExecutor(workspace, 'demo', 'build', root)
})
