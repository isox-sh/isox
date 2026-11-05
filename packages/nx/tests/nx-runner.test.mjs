import { createRequire } from 'node:module'

import { test } from 'vitest'

const require = createRequire(import.meta.url)
const assert = require('node:assert/strict')
const { mkdtemp, mkdir, writeFile, rm, symlink } = require('node:fs/promises')
const { tmpdir } = require('node:os')
const { dirname, join } = require('node:path')
const { createLogger, LogLevels, parseWorkspace, runExecutor } = require('@isox-sh/core')

async function fixture(t, { source, manifestKey = 'executors', pkg = '@nx/fixture', nxJson, isoxJson = { nx: { executors: ['@nx'] } } } = {}) {
  const root = await mkdtemp(join(tmpdir(), 'isox-nx-'))

  t.onTestFinished(() => rm(root, {
    recursive: true,
    force: true
  }))
  const write = async (file, content) => {
    const path = join(root, file)

    await mkdir(dirname(path), { recursive: true })
    await writeFile(path, typeof content === 'string' ? content : JSON.stringify(content))
  }

  await mkdir(join(root, 'node_modules/@isox-sh'), { recursive: true })
  await symlink(join(import.meta.dirname, '../../../dist/nx'), join(root, 'node_modules/@isox-sh/nx'), 'junction')
  await write('isox.json', isoxJson)

  if (nxJson !== undefined) {
    await write('nx.json', nxJson)
  }

  await write('apps/demo/project.json', {
    $schema: '../../node_modules/nx/schemas/project-schema.json',
    name: 'demo',
    projectType: 'application',
    implicitDependencies: ['shared'],
    tags: ['app'],
    sourceRoot: 'apps/demo/src',
    custom: { owner: 'demo-team' },
    targets: {
      build: {
        executor: `${pkg}:build`,
        options: { answer: 42 },
        custom: { region: 'eu' }
      }
    },
  })
  await write('libs/shared/project.json', { name: 'shared' })
  await write(`node_modules/${pkg}/package.json`, {
    name: pkg,
    [manifestKey]: './config/executors.json'
  })
  await write(`node_modules/${pkg}/config/executors.json`, {
    [manifestKey]: { build: { implementation: '../executor.cjs' } },
  })
  await write(`node_modules/${pkg}/executor.cjs`, source)

  return {
    root,
    write,
    workspace: await parseWorkspace(root)
  }
}

for (const [entry, pkg] of [
  ['@nx-extend', '@nx-extend/gcp'],
  ['@nx-extend', '@nx-extend/other'],
  ['@nx-extend/gcp', '@nx-extend/gcp'],
  ['nx-plugin', 'nx-plugin'],
]) {
  for (const manifestKey of ['executors', 'builders']) {
    test(`nx.executors entry ${entry} routes ${pkg} through its ${manifestKey} manifest`, async (t) => {
      const { root, workspace } = await fixture(t, {
        pkg,
        manifestKey,
        isoxJson: { nx: { executors: ['unrelated', entry] } },
        source: `module.exports = (options, context) => {
          const assert = require('node:assert/strict')
          assert.deepEqual(options, { answer: 42 })
          assert.equal(context.targetName, 'build')
          assert.ok(context.projectGraph.nodes.demo)
          assert.equal(Object.hasOwn(context, 'commandName'), false)
          return { success: true }
        }`,
      })

      await runExecutor(workspace, 'demo', 'build', root)
      await runExecutor(await parseWorkspace(root), 'demo', 'build', root)
    })
  }
}

for (const [entry, pkg] of [
  ['@nx-extend', '@nx-extend-extra/gcp'],
  ['@nx-extend/gcp', '@nx-extend/gcp-extra'],
  ['@nx-extend/gcp', '@nx-extend/other'],
  ['nx-plugin', 'nx-plugin-extra'],
]) {
  test(`nx.executors entry ${entry} does not match ${pkg}`, async (t) => {
    const { root, workspace } = await fixture(t, {
      pkg,
      manifestKey: 'executors',
      isoxJson: { nx: { executors: [entry] } },
      nxJson: '{broken',
      source: `module.exports = (options, context) => {
        require('node:assert/strict').equal(context.commandName, 'build')
        return { success: true }
      }`,
    })

    await runExecutor(workspace, 'demo', 'build', root)
  })
}

test('nx.executors changes apply with an existing workspace cache', async (t) => {
  const { root, write, workspace } = await fixture(t, {
    pkg: '@nx-extend/gcp',
    source: `module.exports = (options, context) => {
      const assert = require('node:assert/strict')
      assert.equal(context.targetName, options.nx ? 'build' : undefined)
      assert.equal(context.commandName, options.nx ? undefined : 'build')
      return { success: true }
    }`,
  })

  await runExecutor(workspace, 'demo', 'build', root)
  workspace.projects.demo.targets.build.options.nx = true
  await write('isox.json', { nx: { executors: ['@nx-extend'] } })
  const cached = await parseWorkspace(root)

  cached.projects.demo.targets.build.options.nx = true
  await runExecutor(cached, 'demo', 'build', root)
  workspace.projects.demo.targets.build.options.nx = false
  await write('isox.json', { nx: { executors: [] } })
  await runExecutor(workspace, 'demo', 'build', root)
})

test('workspace settings report malformed nx.executors configuration', async (t) => {
  const { root, write, workspace } = await fixture(t, { source: 'module.exports = () => ({ success: true })' })

  for (const settings of [
    '{broken', null, [], { nx: null }, { nx: [] },
    { nx: { executors: '@nx-extend' } },
    ...[42, null, '', '@', '@nx-extend/', '@nx-extend/*', 'has spaces', '@nx-extend/gcp:build']
      .map(entry => ({ nx: { executors: [entry] } })),
  ]) {
    await write('isox.json', settings)
    await assert.rejects(runExecutor(workspace, 'demo', 'build', root), /Invalid workspace configuration.*isox\.json/)
  }
})

test('@nx packages use the adapter only when selected by nx.executors', async (t) => {
  const { root, write, workspace } = await fixture(t, {
    source: `module.exports = (options, context) => {
      const assert = require('node:assert/strict')
      assert.equal(context.targetName, options.nx ? 'build' : undefined)
      assert.equal(context.commandName, options.nx ? undefined : 'build')
      return { success: true }
    }`,
  })

  workspace.projects.demo.targets.build.options.nx = true
  for (const entry of ['@nx', '@nx/fixture']) {
    await write('isox.json', { nx: { executors: [entry] } })
    await runExecutor(workspace, 'demo', 'build', root)
  }

  workspace.projects.demo.targets.build.options.nx = false
  for (const settings of [{}, { nx: {} }, { nx: { executors: [] } }, { nx: { executors: ['@nx-extend'] } }]) {
    await write('isox.json', settings)
    await runExecutor(workspace, 'demo', 'build', root)
  }

  await rm(join(root, 'isox.json'))
  await runExecutor(workspace, 'demo', 'build', root)
})

for (const manifestKey of ['executors', 'builders']) {
  test(`routes @nx executors through the adapter with a ${manifestKey} manifest`, async (t) => {
    const { root, workspace } = await fixture(t, {
      manifestKey,
      nxJson: { targetDefaults: { build: { options: { notMerged: true } } } },
      source: `
        const assert = require('node:assert/strict')
        exports.default = async (options, context) => {
          assert.deepEqual(options, { answer: 42 })
          assert.equal(context.root, context.cwd)
          assert.ok(require('node:path').isAbsolute(context.root))
          assert.equal(context.projectName, 'demo')
          assert.equal(context.targetName, 'build')
          assert.equal(context.target.executor, '@nx/fixture:build')
          assert.equal(context.isVerbose, true)
          assert.equal(context.projectsConfigurations.version, 2)
          assert.equal(context.workspace, context.projectsConfigurations)
          const project = context.projectsConfigurations.projects.demo
          assert.equal(project.root, 'apps/demo')
          assert.equal(project.sourceRoot, 'apps/demo/src')
          assert.deepEqual(project.custom, { owner: 'demo-team' })
          assert.deepEqual(context.target.custom, { region: 'eu' })
          assert.equal(project.targets.build, context.target)
          assert.deepEqual(project.implicitDependencies, ['shared'])
          assert.deepEqual(project.tags, ['app'])
          assert.equal(context.workspace.projects.shared.root, 'libs/shared')
          assert.equal(context.nxJsonConfiguration.targetDefaults.build.options.notMerged, true)
          const graph = context.projectGraph
          assert.deepEqual(Object.keys(graph.nodes).sort(), ['demo', 'shared'])
          assert.equal(graph.nodes.demo.name, 'demo')
          assert.equal(graph.nodes.demo.type, 'app')
          assert.equal(graph.nodes.demo.data, project)
          assert.equal(graph.nodes.demo.data.targets.build, context.target)
          assert.equal(graph.nodes.shared.type, 'lib')
          assert.equal(graph.nodes.shared.data, context.projectsConfigurations.projects.shared)
          assert.deepEqual(graph.dependencies.demo, [{ source: 'demo', target: 'shared', type: 'implicit' }])
          assert.deepEqual(graph.dependencies.shared, [])
          assert.deepEqual(graph.externalNodes, {})
          const taskId = 'demo:build'
          assert.deepEqual(context.taskGraph.roots, [taskId])
          assert.deepEqual(Object.keys(context.taskGraph.tasks), [taskId])
          const task = context.taskGraph.tasks[taskId]
          assert.equal(task.id, taskId)
          assert.deepEqual(task.target, { project: 'demo', target: 'build' })
          assert.equal(task.projectRoot, 'apps/demo')
          assert.deepEqual(task.overrides, {})
          assert.deepEqual(task.outputs, [])
          assert.equal(task.cache, false)
          assert.deepEqual(context.taskGraph.dependencies[taskId], [])
          assert.deepEqual(context.taskGraph.continuousDependencies[taskId], [])
          assert.equal(Object.hasOwn(context, 'commandName'), false)
          assert.equal(Object.hasOwn(project, 'executors'), false)
          return { success: true }
        }
      `,
    })
    const original = structuredClone(workspace.projects.demo)
    const entries = []
    const logger = createLogger({
      level: LogLevels.debug,
      reporters: [{ log: entry => entries.push(entry) }]
    })

    await runExecutor(workspace, 'demo', 'build', root, logger)
    // Graph context must also be available when discovery reads the persisted cache.
    await runExecutor(await parseWorkspace(root), 'demo', 'build', root, logger)
    assert.deepEqual(workspace.projects.demo, original)
    assert.ok(entries.some(entry => entry.args[0].includes('Using Nx adapter')))
    assert.equal(entries.at(-1).type, 'success')
  })
}

for (const [label, source, fails] of [
  ['synchronous result without nx.json', `module.exports = (options, context) => {
    require('node:assert/strict').deepEqual(context.nxJsonConfiguration, {})
    return { success: true }
  }`, false],
  ['async iterable', 'module.exports = async function* () { yield { success: true } }', false],
  ['failed result', 'module.exports = () => ({ success: false })', true],
  ['failed iterable', 'module.exports = async function* () { yield { success: false } }', true],
  ['thrown error', 'module.exports = () => { throw new Error("plugin failed") }', true],
]) {
  test(`Nx adapter handles a ${label}`, async (t) => {
    const { root, workspace } = await fixture(t, { source })
    const result = runExecutor(workspace, 'demo', 'build', root)

    if (fails) {
      await assert.rejects(result, /Task failed|plugin failed/)
    } else {
      await result
    }
  })
}

test('similar package prefixes still receive the native context and ignore nx.json', async (t) => {
  const { root, workspace } = await fixture(t, {
    pkg: '@nx-custom/fixture',
    manifestKey: 'executors',
    nxJson: '{broken',
    source: `module.exports = (options, context) => {
      const assert = require('node:assert/strict')
      assert.equal(context.commandName, 'build')
      assert.equal(context.workspace.projects.demo.targets.build.executor, '@nx-custom/fixture:build')
      assert.equal(Object.hasOwn(context, 'targetName'), false)
      return { success: true }
    }`,
  })

  await runExecutor(workspace, 'demo', 'build', root)
})

test('Nx adapter reports invalid nx.json rather than discarding its settings', async (t) => {
  const { root, workspace } = await fixture(t, {
    nxJson: '{broken',
    source: 'module.exports = () => ({ success: true })',
  })

  await assert.rejects(runExecutor(workspace, 'demo', 'build', root), SyntaxError)
})

test('Nx project graph preserves transitive dependencies and isolated projects', async (t) => {
  const { root, workspace } = await fixture(t, {
    source: `module.exports = (options, context) => {
      const assert = require('node:assert/strict')
      const graph = context.projectGraph
      const dependencies = new Set()
      function visit(name) {
        assert.ok(graph.nodes[name])
        for (const edge of graph.dependencies[name]) {
          assert.equal(edge.source, name)
          if (!dependencies.has(edge.target)) {
            dependencies.add(edge.target)
            visit(edge.target)
          }
        }
      }
      visit('demo')
      assert.deepEqual([...dependencies], ['shared', 'foundation'])
      assert.equal(graph.nodes.foundation.data.root, 'libs/foundation')
      assert.equal(graph.nodes.foundation.type, 'lib')
      assert.equal(graph.nodes.__proto__.name, '__proto__')
      assert.deepEqual(graph.dependencies.__proto__, [])
      assert.equal(Object.hasOwn(graph.nodes, 'toString'), false)
      return { success: true }
    }`,
  })

  workspace.projects.shared.dependencies = ['foundation']
  workspace.projects.foundation = {
    name: 'foundation',
    root: 'libs/foundation',
    projectType: 'library'
  }
  workspace.projects.__proto__ = {
    name: '__proto__',
    root: 'libs/isolated'
  }
  await runExecutor(workspace, 'demo', 'build', root)
})

test('Nx adapter reports dangling dependencies instead of providing broken graph edges', async (t) => {
  const { root, workspace } = await fixture(t, {
    source: 'module.exports = () => { throw new Error("executor should not run") }',
  })

  for (const missing of ['missing', 'toString']) {
    workspace.projects.demo.dependencies = [missing]
    await assert.rejects(runExecutor(workspace, 'demo', 'build', root),
      new RegExp(`Cannot create Nx project graph: project demo depends on unknown project ${missing}`))
  }
})

for (const [label, manifest, source, expected] of [
  ['missing manifest', undefined, 'module.exports = () => ({ success: true })', /does not define an executors or builders manifest/],
  ['missing executor', { executors: {} }, '', /Executor build not found/],
  ['inherited executor', { executors: {} }, '', /Executor toString not found/],
  ['invalid implementation', { executors: { build: { implementation: 42 } } }, '', /Executor build not found/],
  ['non-callable export', { executors: { build: { implementation: '../executor.cjs' } } }, 'module.exports = {}', /does not export a function/],
]) {
  test(`Nx plugin rejects a ${label}`, async (t) => {
    const { root, write, workspace } = await fixture(t, { source })

    if (manifest === undefined) {
      await write('node_modules/@nx/fixture/package.json', { name: '@nx/fixture' })
    } else {
      await write('node_modules/@nx/fixture/config/executors.json', manifest)
    }

    if (label === 'inherited executor') {
      workspace.projects.demo.targets.build.executor = '@nx/fixture:toString'
    }

    await assert.rejects(runExecutor(workspace, 'demo', 'build', root), expected)
  })
}
