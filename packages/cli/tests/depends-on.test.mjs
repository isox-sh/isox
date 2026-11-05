import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'

import { test } from 'vitest'

const require = createRequire(import.meta.url)
const { createTaskGraph, parseWorkspace, runExecutor } = require('../../../dist/core')
const { parseProjectDefinition } = require('../../../dist/core/workspace/configuration')
const cli = resolve(import.meta.dirname, '../../../dist/cli/index.js')
const target = extra => ({
  executor: 'fixture:run',
  ...extra
})

async function fixture(t, projects, settings = {}) {
  const root = await mkdtemp(join(tmpdir(), 'isox-depends-'))
  t.onTestFinished(() => rm(root, {
    recursive: true,
    force: true
  }))
  const write = async (file, value) => {
    await mkdir(dirname(join(root, file)), { recursive: true })
    await writeFile(join(root, file), typeof value === 'string' ? value : JSON.stringify(value))
  }

  await write('isox.json', settings)
  for (const [name, project] of Object.entries(projects)) {
    await write(`${name}/project.json`, {
      name,
      ...project
    })
  }

  await write('node_modules/fixture/package.json', { executors: './executors.json' })
  await write('node_modules/fixture/executors.json', { executors: { run: { implementation: './run.cjs' } } })
  await write('node_modules/fixture/run.cjs', `module.exports = async (options, context) => {
    require('node:fs').appendFileSync(require('node:path').join(context.workspaceRoot, 'events'), JSON.stringify({
      id: context.projectName + ':' + context.commandName, configuration: context.configurationName, options
    }) + '\\n')
    await new Promise(resolve => setTimeout(resolve, 20))
    return { success: !options.fail }
  }`)

  return {
    root,
    write,
    events: async () => (await readFile(join(root, 'events'), 'utf8')).trim().split('\n').map(line => JSON.parse(line)),
    run: args => spawnSync(process.execPath, [cli, ...args], {
      cwd: root,
      encoding: 'utf8'
    }),
  }
}

for (const mode of ['direct', 'run-many', 'affected', 'api']) {
  test(`${mode} expands inherited prerequisites and executes shared tasks once`, async t => {
    const f = await fixture(t, {
      app: {
        dependencies: ['bridge'],
        targets: {
          build: target({}),
          test: target({
            dependsOn: ['build', {
              projects: ['lib'],
              target: 'build'
            }]
          })
        }
      },
      bridge: { dependencies: ['lib'] },
      lib: {
        targets: {
          build: target({}),
          prepare: target({})
        }
      },
    }, { targetDefaults: { build: { dependsOn: ['^build', 'prepare'] } } })
    if (mode === 'api') {
      await runExecutor(await parseWorkspace(f.root), 'app', 'test', f.root)
    } else {
      const result = f.run(mode === 'direct' ? ['test', 'app'] : [mode, '--target=test', ...(mode === 'affected' ? ['--all'] : ['--projects=app']), '--parallel=3'])
      assert.equal(result.status, 0, result.stderr + result.stdout)
    }

    assert.deepEqual((await f.events()).map(event => event.id), ['lib:prepare', 'lib:build', 'app:build', 'app:test'])
  })
}

test('parallel roots share prerequisites, including explicitly selected prerequisite projects', async t => {
  const f = await fixture(t, {
    a: {
      dependencies: ['lib'],
      targets: { build: target({ dependsOn: ['^build'] }) }
    },
    b: {
      dependencies: ['lib'],
      targets: { build: target({ dependsOn: ['^build'] }) }
    },
    lib: { targets: { build: target({}) } },
  })
  const result = f.run(['run-many', '--target=build', '--projects=a,b,lib', '--parallel=3', '--value=cli'])
  assert.equal(result.status, 0, result.stderr)
  const events = await f.events()
  assert.equal(events[0].options.value, 'cli')
  const ids = events.map(event => event.id)
  assert.equal(ids[0], 'lib:build')
  assert.deepEqual(ids.slice(1).sort(), ['a:build', 'b:build'])
})

test('expanded syntax forwards options and params independently with configuration fallback', async t => {
  const f = await fixture(t, {
    app: {
      targets: {
        test: target({
          options: { value: 'base' },
          configurations: { production: { value: 'production' } },
          dependsOn: [
            {
              target: 'prepare',
              params: 'forward',
              options: 'forward'
            },
            {
              projects: 'lib',
              target: 'build'
            },
          ]
        }),
        prepare: target({ configurations: { production: { own: true } } }),
      }
    },
    lib: {
      targets: {
        build: target({
          defaultConfiguration: 'dev',
          configurations: { dev: { value: 'dev' } }
        })
      }
    },
  })
  const result = f.run(['test', 'app', '--config=production', '--value=cli'])
  assert.equal(result.status, 0, result.stderr)
  assert.deepEqual(await f.events(), [
    {
      id: 'app:prepare',
      configuration: 'production',
      options: {
        own: true,
        value: 'cli'
      }
    },
    {
      id: 'lib:build',
      configuration: 'dev',
      options: { value: 'dev' }
    },
    {
      id: 'app:test',
      configuration: 'production',
      options: { value: 'cli' }
    },
  ])
})

test('cycles fail before execution and prerequisite failures stop dependents', async t => {
  const f = await fixture(t, {
    app: {
      targets: {
        build: target({ dependsOn: ['prepare'] }),
        prepare: target({ dependsOn: ['build'] }),
      }
    }
  })
  let result = f.run(['build', 'app'])
  assert.equal(result.status, 1)
  assert.match(result.stderr, /app:build -> app:prepare -> app:build/)
  await assert.rejects(f.events(), { code: 'ENOENT' })
  await f.write('app/project.json', {
    name: 'app',
    targets: {
      build: target({ dependsOn: ['prepare'] }),
      prepare: target({ options: { fail: true } }),
    }
  })
  await rm(join(f.root, '.isox/workspace.json'), { force: true })
  for (const args of [['build', 'app'], ['run-many', '--target=build', '--projects=app', '--parallel=2']]) {
    await rm(join(f.root, 'events'), { force: true })
    result = f.run(args)
    assert.equal(result.status, 1)
    assert.deepEqual((await f.events()).map(event => event.id), ['app:prepare'])
  }
})

test('wildcards, project references, and empty local overrides are supported', async t => {
  const f = await fixture(t, {
    app: {
      targets: {
        test: target({ dependsOn: ['build-*', 'lib:build'] }),
        'build-a': target({}),
        'build-b': target({})
      }
    },
    lib: { targets: { build: target({ dependsOn: [] }) } },
  }, { targetDefaults: { build: { dependsOn: ['build'] } } })
  const tasks = await createTaskGraph(f.root, await parseWorkspace(f.root), [{
    project: 'app',
    target: 'test'
  }])
  assert.deepEqual([...tasks.keys()], ['app:build-a', 'app:build-b', 'lib:build', 'app:test'])
})

test('invalid dependency declarations are rejected', () => {
  for (const dependsOn of [true, [null], [''], [{
    target: 'build',
    params: 'yes'
  }], [{ projects: ['lib'] }], [{
    target: 'build',
    dependencies: true,
    projects: 'lib'
  }]]) {
    assert.throws(() => parseProjectDefinition({ targets: { build: target({ dependsOn }) } }, 'project.json'), /Invalid project configuration/)
  }
})

test('inferred package dependencies expand caret targets', async t => {
  const f = await fixture(t, {
    app: { targets: { build: target({ dependsOn: ['^build'] }) } },
    lib: { targets: { build: target({}) } },
  })
  await f.write('app/package.json', {
    name: 'app',
    dependencies: { '@demo/lib': 'workspace:*' }
  })
  await f.write('lib/package.json', { name: '@demo/lib' })
  const result = f.run(['build', 'app'])
  assert.equal(result.status, 0, result.stderr)
  assert.deepEqual((await f.events()).map(event => event.id), ['lib:build', 'app:build'])
})

test('cached dependents still run uncached prerequisites', async t => {
  const f = await fixture(t, {
    app: {
      targets: {
        build: target({
          cache: true,
          dependsOn: ['prepare']
        }),
        prepare: target({}),
      }
    }
  })
  for (let attempt = 0; attempt < 2; attempt++) {
    const result = f.run(['build', 'app'])
    assert.equal(result.status, 0, result.stderr)
  }

  assert.deepEqual((await f.events()).map(event => event.id), ['app:prepare', 'app:build', 'app:prepare'])
})

test('unknown explicit project references fail during planning', async t => {
  const f = await fixture(t, { app: { targets: { build: target({ dependsOn: ['missing:build'] }) } } })
  const result = f.run(['build', 'app'])
  assert.equal(result.status, 1)
  assert.match(result.stderr, /Project missing not found/)
  await assert.rejects(f.events(), { code: 'ENOENT' })
})
