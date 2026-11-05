import assert from 'node:assert/strict'
import { mkdir, mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'

import { test } from 'vitest'

const require = createRequire(import.meta.url)
const { createLogger, parseWorkspace, readWorkspaceSettings, resetWorkspace, resolveCommandOptions, resolveTargetDefaults, runExecutor, addTargetDefaults } = require('../../../dist/core')
const logger = createLogger({ level: -Infinity })

async function fixture(t) {
  const root = await mkdtemp(join(tmpdir(), 'isox-defaults-'))

  t.onTestFinished(() => rm(root, {
    recursive: true,
    force: true
  }))
  const write = async (file, value) => {
    await mkdir(dirname(join(root, file)), { recursive: true })
    await writeFile(join(root, file), typeof value === 'string' ? value : JSON.stringify(value))
  }

  await write('isox.json', {})

  return {
    root,
    write
  }
}

test('merges name, executor and project defaults with shallow option values and per-configuration overrides', () => {
  const settings = {
    targetDefaults: {
      build: {
        cache: true,
        outputs: ['dist/default'],
        inputs: ['a'],
        defaultConfiguration: 'acc',
        options: {
          base: 1,
          choice: 'name',
          nested: { name: true },
          list: [1]
        },
        configurations: {
          acc: {
            base: true,
            choice: 'name',
            nested: { name: true }
          },
          production: { prod: true }
        },
      },
      'js:tsc': {
        options: {
          executor: true,
          choice: 'executor',
          nested: { executor: true }
        },
        configurations: {
          acc: {
            executor: true,
            choice: 'executor'
          }
        },
      },
    }
  }
  const workspace = {
    projects: {
      demo: {
        name: 'demo',
        root: 'demo',
        targets: {
          build: {
            executor: '@isox-sh/js:tsc',
            cache: false,
            inputs: [],
            outputs: [],
            options: {
              local: true,
              choice: 'local',
              list: [],
              nested: { local: true }
            },
            configurations: {
              acc: {
                choice: 'local',
                nested: { local: true }
              }
            },
          }
        }
      }
    }
  }
  const original = structuredClone([workspace, settings])
  const result = resolveTargetDefaults(workspace, settings).projects.demo.targets.build

  assert.deepEqual(result.options, {
    base: 1,
    executor: true,
    local: true,
    choice: 'local',
    list: [],
    nested: { local: true }
  })
  assert.deepEqual(result.configurations.acc, {
    base: true,
    executor: true,
    choice: 'local',
    nested: { local: true }
  })
  assert.deepEqual(result.configurations.production, { prod: true })
  assert.deepEqual(result.inputs, [])
  assert.deepEqual(result.outputs, [])
  assert.equal(result.cache, false)
  assert.equal(resolveCommandOptions(result, 'demo', 'build').configurationName, 'acc')
  assert.deepEqual([workspace, settings], original)
})

test('executor aliases work both ways, exact spelling wins, and defaults do not create targets', () => {
  for (const [executor, key] of [['js:tsc', '@isox-sh/js:tsc'], ['@isox-sh/js:tsc', 'js:tsc']]) {
    const workspace = {
      projects: {
        demo: {
          name: 'demo',
          root: '.',
          targets: { build: { executor } }
        }
      }
    }
    const settings = {
      targetDefaults: {
        [key]: { options: { fromAlias: true } },
        absent: { cache: true }
      }
    }

    assert.deepEqual(resolveTargetDefaults(workspace, settings).projects.demo.targets.build.options, { fromAlias: true })
    settings.targetDefaults[executor] = { options: { fromAlias: false } }
    const targets = resolveTargetDefaults(workspace, settings).projects.demo.targets

    assert.deepEqual(Object.keys(targets), ['build'])
    assert.equal(targets.build.options.fromAlias, false)
  }
})

test('cached definitions include merged defaults and keep them until refresh or reset', async t => {
  const { root, write } = await fixture(t)

  await write('apps/demo/project.json', {
    name: 'demo',
    targets: {
      test: {
        executor: 'vitest:test',
        cache: true
      }
    }
  })
  await write('isox.json', {
    targetDefaults: {
      'vitest:test': {
        outputs: [],
        options: { configFile: 'first.ts' }
      }
    }
  })
  // Version 13 stored raw definitions; it must be rebuilt rather than reused.
  await write('.isox/workspace.json', {
    version: 13,
    projects: {
      demo: {
        name: 'demo',
        root: 'apps/demo',
        targets: {
          test: {
            executor: 'vitest:test',
            cache: true
          }
        }
      }
    }
  })
  const first = await parseWorkspace(root, { logger })
  const file = join(root, '.isox/workspace.json')
  const before = await stat(file)
  const cached = JSON.parse(await readFile(file, 'utf8'))

  assert.deepEqual(cached.projects.demo.targets.test, first.projects.demo.targets.test)
  assert.deepEqual(cached.projects.demo.targets.test.outputs, [])
  assert.equal(first.projects.demo.targets.test.options.configFile, 'first.ts')
  await write('isox.json', {
    targetDefaults: {
      'vitest:test': {
        outputs: [],
        options: { configFile: 'second.ts' }
      }
    }
  })
  assert.equal((await parseWorkspace(root, { logger })).projects.demo.targets.test.options.configFile, 'first.ts')
  assert.equal((await stat(file)).mtimeMs, before.mtimeMs)
  assert.equal((await parseWorkspace(root, {
    logger,
    cache: false
  })).projects.demo.targets.test.options.configFile, 'second.ts')
  await write('isox.json', { targetDefaults: { 'vitest:test': { outputs: [] } } })
  await resetWorkspace(root)
  assert.equal((await parseWorkspace(root, { logger })).projects.demo.targets.test.options, undefined)
  await write('isox.json', {})
  assert.deepEqual((await parseWorkspace(root, { logger })).projects.demo.targets.test.outputs, [])
  assert.equal((await parseWorkspace(root, {
    logger,
    cache: false
  })).projects.demo.targets.test.outputs, undefined)
})

test('rejects malformed defaults and accepts omitted or empty outputs', async t => {
  const { root, write } = await fixture(t)

  for (const targetDefaults of [[], { build: [] }, { build: { options: [] } }, { build: { cache: 'yes' } }, { build: { outputs: [1] } }, { 'bad key': {} }]) {
    await write('isox.json', { targetDefaults })
    await assert.rejects(readWorkspaceSettings(root), /Invalid workspace configuration/)
  }

  await write('isox.json', { targetDefaults: { build: { cache: true } } })
  await write('apps/demo/project.json', {
    name: 'demo',
    targets: { build: { executor: 'js:tsc' } }
  })
  assert.equal((await parseWorkspace(root, { logger })).projects.demo.targets.build.outputs, undefined)
  await write('isox.json', {
    targetDefaults: {
      build: {
        cache: true,
        outputs: []
      }
    }
  })
  assert.deepEqual((await parseWorkspace(root, {
    logger,
    cache: false
  })).projects.demo.targets.build.outputs, [])
})

test('runExecutor uses cached defaults without merging again, then applies configuration and CLI overrides', async t => {
  const { root, write } = await fixture(t)

  await write('apps/demo/input.txt', 'input')
  await write('isox.json', {
    targetDefaults: {
      build: {
        cache: true,
        outputs: ['dist/demo'],
        options: {
          name: true,
          value: 'name'
        }
      },
      '@fixture/plugin:build': {
        options: {
          plugin: true,
          value: 'plugin'
        },
        configurations: {
          acc: {
            configuration: true,
            value: 'acc'
          }
        }
      },
    }
  })
  await write('node_modules/@fixture/plugin/package.json', {
    name: '@fixture/plugin',
    executors: './executors.json'
  })
  await write('node_modules/@fixture/plugin/executors.json', { executors: { build: { implementation: './build.cjs' } } })
  await write('node_modules/@fixture/plugin/build.cjs', String.raw`
    module.exports = async (options, context) => {
      const fs = require('node:fs/promises')
      const { join } = require('node:path')
      await fs.appendFile(join(context.workspaceRoot, 'runs'), 'run\n')
      await fs.mkdir(join(context.workspaceRoot, 'dist/demo'), { recursive: true })
      await fs.writeFile(join(context.workspaceRoot, 'dist/demo/options.json'), JSON.stringify(options))
      return { success: true }
    }
  `)
  await write('apps/demo/project.json', {
    name: 'demo',
    targets: {
      build: {
        executor: '@fixture/plugin:build',
        options: {
          local: true,
          value: 'local'
        },
      }
    }
  })
  const workspace = await parseWorkspace(root, { logger })
  const settings = await readWorkspaceSettings(root)

  settings.targetDefaults['@fixture/plugin:build'].options.afterDiscovery = true
  await write('isox.json', settings)
  const run = async () => runExecutor(await parseWorkspace(root, { logger }), 'demo', 'build', root, logger, 'acc', undefined, { value: 'cli' })

  await run()
  await rm(join(root, 'dist'), { recursive: true })
  await run()
  assert.equal(await readFile(join(root, 'runs'), 'utf8'), 'run\n')
  assert.deepEqual(JSON.parse(await readFile(join(root, 'dist/demo/options.json'), 'utf8')), {
    name: true,
    plugin: true,
    local: true,
    configuration: true,
    value: 'cli',
  })
  assert.equal(workspace.projects.demo.targets.build.cache, true)
  assert.equal(workspace.projects.demo.targets.build.options.value, 'local')
})

test('generators add only missing executor defaults and preserve explicit values, aliases and unrelated metadata', async t => {
  const { root, write } = await fixture(t)
  const context = {
    workspaceRoot: root,
    projectRoot: root,
    projectName: 'demo',
    logger
  }

  await write('isox.json', {
    version: '1',
    custom: 'kept',
    targetDefaults: {
      '@isox-sh/vitest:test': {
        cache: false,
        options: { configFile: 'custom.ts' }
      },
    }
  })
  await addTargetDefaults('vitest:test', {
    cache: true,
    outputs: []
  }, context)
  const source = await readFile(join(root, 'isox.json'), 'utf8')

  assert.deepEqual(JSON.parse(source), {
    version: '1',
    custom: 'kept',
    targetDefaults: {
      '@isox-sh/vitest:test': {
        cache: false,
        outputs: [],
        options: { configFile: 'custom.ts' }
      },
    }
  })
  await addTargetDefaults('vitest:test', {
    cache: true,
    outputs: []
  }, context)
  assert.equal(await readFile(join(root, 'isox.json'), 'utf8'), source)
})

test('Nx adapter targets accept common defaults without enabling native cache output requirements', () => {
  const workspace = {
    projects: {
      demo: {
        name: 'demo',
        root: '.',
        targets: { build: { executor: '@nx/js:tsc' } }
      }
    }
  }
  const settings = {
    nx: { executors: ['@nx'] },
    targetDefaults: {
      build: { cache: true },
      '@nx/js:tsc': { options: { migration: true } }
    }
  }

  assert.deepEqual(resolveTargetDefaults(workspace, settings).projects.demo.targets.build.options, { migration: true })
})
