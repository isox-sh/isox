const assert = require('node:assert/strict')
const { mkdtemp, mkdir, writeFile, rm } = require('node:fs/promises')
const { tmpdir } = require('node:os')
const { dirname, join } = require('node:path')
const { test } = require('node:test')
const { parseWorkspace, runExecutor } = require('../dist')

async function fixture(t, executor) {
  const root = await mkdtemp(join(tmpdir(), 'isox-nx-graph-'))
  t.after(() => rm(root, { recursive: true, force: true }))
  const write = async (file, content) => {
    const path = join(root, file)
    await mkdir(dirname(path), { recursive: true })
    await writeFile(path, typeof content === 'string' ? content : JSON.stringify(content))
  }
  await write('isox.json', { nx: { executors: ['@nx'] } })
  await write('apps/demo/project.json', {
    name: 'demo', dependencies: ['shared'],
    commands: { build: { executor: '@nx/fixture:build', options: { answer: 42 } } },
  })
  await write('libs/shared/project.json', { name: 'shared' })
  await write('node_modules/@nx/fixture/package.json', { name: '@nx/fixture', executors: './executors.json' })
  await write('node_modules/@nx/fixture/executors.json', { executors: { build: { implementation: './build.cjs' } } })
  await write('node_modules/@nx/fixture/build.cjs', executor)
  await write('node_modules/nx/package.json', {
    name: 'nx', exports: { './package.json': './package.json', './src/project-graph/project-graph': './graph.cjs' },
  })
  return { root, write, workspace: await parseWorkspace(root) }
}

test('Nx graph supplies external packages, inferred projects and file dependencies on fresh and cached runs', async t => {
  const { root, write, workspace } = await fixture(t, `module.exports = (options, context) => {
    const assert = require('node:assert/strict')
    const fs = require('node:fs')
    const path = require('node:path')
    const graph = context.projectGraph
    const version = fs.readFileSync(path.join(context.root, 'version.txt'), 'utf8')
    // The same lookup that failed in Nx createPackageJson with helperDependencies.
    assert.deepEqual(graph.externalNodes['npm:tslib'].data, { packageName: 'tslib', version })
    assert.deepEqual(graph.externalNodes['npm:runtime'].data, { packageName: 'runtime', version: '1.2.3' })
    assert.deepEqual(graph.dependencies.demo, [{ source: 'demo', target: 'shared', type: 'static' }])
    assert.deepEqual(graph.dependencies.shared, [{ source: 'shared', target: 'npm:runtime', type: 'static' }])
    assert.deepEqual(graph.dependencies['npm:runtime'], [{ source: 'npm:runtime', target: 'npm:tslib', type: 'static' }])
    assert.equal(graph.nodes.inferred.data.root, 'packages/inferred')
    assert.equal(context.projectsConfigurations.projects.inferred, graph.nodes.inferred.data)
    assert.equal(context.projectsConfigurations.projects.demo, graph.nodes.demo.data)
    assert.equal(graph.nodes.demo.data.sourceRoot, 'apps/demo/src')
    assert.equal(graph.nodes.demo.data.targets.build, context.target)
    assert.deepEqual(options, { answer: 42 })
    const map = JSON.parse(fs.readFileSync(path.join(context.root, '.nx/workspace-data/file-map.json'), 'utf8'))
    assert.equal(map.version, version)
    assert.deepEqual(map.fileMap.projectFileMap.shared[0].deps, ['npm:runtime'])
    return { success: true }
  }`)
  await write('node_modules/nx/graph.cjs', `exports.createProjectGraphAsync = async options => {
    const assert = require('node:assert/strict')
    const fs = require('node:fs')
    assert.equal(options.exitOnError, false)
    assert.equal(fs.realpathSync(process.cwd()), fs.realpathSync(process.env.NX_WORKSPACE_ROOT_PATH))
    assert.equal(process.env.NX_DAEMON, 'false')
    assert.equal(process.env.NX_CACHE_PROJECT_GRAPH, 'true')
    assert.equal(process.env.NX_FORCE_REUSE_CACHED_GRAPH, 'false')
    const version = fs.readFileSync('version.txt', 'utf8')
    fs.mkdirSync('.nx/workspace-data', { recursive: true })
    fs.writeFileSync('.nx/workspace-data/file-map.json', JSON.stringify({
      version, fileMap: { projectFileMap: { shared: [{ file: 'libs/shared/index.ts', deps: ['npm:runtime'] }] } },
    }))
    return {
      nodes: {
        demo: { name: 'demo', type: 'app', data: { name: 'demo', root: 'apps/demo', sourceRoot: 'apps/demo/src', targets: { build: { options: { answer: 0 } } } } },
        inferred: { name: 'inferred', type: 'lib', data: { name: 'inferred', root: 'packages/inferred', targets: {} } },
      },
      dependencies: {
        demo: [{ source: 'demo', target: 'shared', type: 'static' }],
        shared: [{ source: 'shared', target: 'npm:runtime', type: 'static' }],
        'npm:runtime': [{ source: 'npm:runtime', target: 'npm:tslib', type: 'static' }],
      },
      externalNodes: {
        'npm:tslib': { name: 'npm:tslib', type: 'npm', data: { packageName: 'tslib', version } },
        'npm:runtime': { name: 'npm:runtime', type: 'npm', data: { packageName: 'runtime', version: '1.2.3' } },
      },
    }
  }`)
  const original = structuredClone(workspace)
  const originalCwd = process.cwd()
  const originalEnv = { ...process.env }
  await write('version.txt', '2.8.1')
  await runExecutor(workspace, 'demo', 'build', root)
  // Isox's project cache must not freeze installed package versions or file maps.
  await write('version.txt', '2.8.2')
  await runExecutor(await parseWorkspace(root), 'demo', 'build', root)
  assert.deepEqual(structuredClone(workspace), original)
  assert.equal(process.cwd(), originalCwd)
  assert.deepEqual({ ...process.env }, originalEnv)
})

for (const [label, source, expected] of [
  ['graph construction fails', 'exports.createProjectGraphAsync = async () => { throw new Error("invalid lockfile") }', /Cannot build Nx project graph:.*invalid lockfile/s],
  ['worker exits without returning a graph', 'process.exit(7)', /worker exited with 7/],
  ['Nx installation is broken', 'require("missing-nx-dependency")', /Cannot build Nx project graph:.*missing-nx-dependency/s],
]) {
  test(`Nx adapter fails before execution when ${label}`, async t => {
    const { root, write, workspace } = await fixture(t, 'module.exports = () => { throw new Error("executor must not run") }')
    await write('node_modules/nx/graph.cjs', source)
    await assert.rejects(runExecutor(workspace, 'demo', 'build', root), expected)
  })
}
