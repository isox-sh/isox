const assert = require('node:assert/strict')
const { mkdtemp, mkdir, writeFile, rm } = require('node:fs/promises')
const { tmpdir } = require('node:os')
const { basename, dirname, join } = require('node:path')
const { test } = require('node:test')
const { createLogger, findWorkspaceRoot, LogLevels, parseWorkspace, runExecutor } = require('../dist')

async function fixture(t) {
  const root = await mkdtemp(join(tmpdir(), 'isox-test-'))
  t.after(() => rm(root, { recursive: true, force: true }))
  const write = async (file, content) => {
    const path = join(root, file)
    await mkdir(dirname(path), { recursive: true })
    await writeFile(path, typeof content === 'string' ? content : JSON.stringify(content))
  }
  return { root, write }
}

async function executorFixture(t, source, manifestKey = 'commands') {
  const fixtureData = await fixture(t)
  const { root, write } = fixtureData
  await write('isox.json', {})
  await write('apps/demo/project.json', {
    name: 'demo',
    commands: { build: { executor: '@fixture/plugin:build', options: { answer: 42 } } },
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
  ['synchronous result', 'module.exports = () => ({ success: true })', 'commands'],
  ['promise result', 'exports.default = async () => ({ success: true })', 'commands'],
  ['async iterable', `module.exports = async function* () {
    yield { success: true }
    yield { success: true }
  }`, 'commands'],
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
  workspace.projects.demo.commands.build.executor = 'invalid'
  await assert.rejects(runExecutor(workspace, 'demo', 'build', root), /Invalid executor format/)
  workspace.projects.demo.commands.build.executor = '@fixture/plugin:missing'
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
  workspace.projects.demo.commands.build.options = { fail: true }
  await assert.rejects(
    runExecutor(workspace, 'demo', 'build', root, logger),
    /Task failed for demo/,
  )
  assert.deepEqual(logs.map(entry => entry.type), ['debug', 'info'])
})

test('native executors reject builders manifests', async (t) => {
  const { root, workspace } = await executorFixture(t, 'module.exports = () => ({ success: true })', 'builders')
  await assert.rejects(runExecutor(workspace, 'demo', 'build', root), /does not define a commands manifest/)
})

test('runner rejects missing projects and commands in the public API', async (t) => {
  const { root, workspace } = await executorFixture(t, 'module.exports = () => ({ success: true })')
  await assert.rejects(runExecutor(workspace, 'missing', 'build', root), /Project missing not found/)
  await assert.rejects(runExecutor(workspace, 'demo', 'toString', root), /Command toString not found/)
})
