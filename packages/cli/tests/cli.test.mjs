import { createRequire } from 'node:module'

import { test } from 'vitest'

const require = createRequire(import.meta.url)
const __dirname = import.meta.dirname
const assert = require('node:assert/strict')
const { spawnSync } = require('node:child_process')
const { mkdtemp, mkdir, readFile, writeFile, rm } = require('node:fs/promises')
const { tmpdir } = require('node:os')
const { dirname, join, resolve } = require('node:path')

const cliPath = resolve(__dirname, '../../../dist/cli/index.js')

async function fixture(t) {
  const root = await mkdtemp(join(tmpdir(), 'isox-test-'))

  t.onTestFinished(() => rm(root, {
    recursive: true,
    force: true
  }))
  const write = async (file, content) => {
    const path = join(root, file)

    await mkdir(dirname(path), { recursive: true })
    await writeFile(path, typeof content === 'string' ? content : JSON.stringify(content))
  }

  return {
    root,
    write
  }
}

async function executorFixture(t, source, manifestKey = 'executors') {
  const fixtureData = await fixture(t)
  const { write } = fixtureData

  await write('isox.json', {})
  await write('apps/demo/project.json', {
    name: 'demo',
    dependencies: [],
    custom: { owner: 'demo-team' },
    targets: {
      build: {
        executor: '@fixture/plugin:build',
        options: { answer: 42 },
        custom: { region: 'eu' }
      }
    },
  })
  await write('node_modules/@fixture/plugin/package.json', {
    name: '@fixture/plugin',
    [manifestKey]: './config/registry.json',
  })
  await write('node_modules/@fixture/plugin/config/registry.json', {
    [manifestKey]: { build: { implementation: '../executor.cjs' } },
  })
  await write('node_modules/@fixture/plugin/executor.cjs', source)

  return fixtureData
}

test('reports a missing workspace marker in the CLI', async (t) => {
  const { root, write } = await fixture(t)

  await write('project.json', { name: 'demo' })
  const result = spawnSync(process.execPath, [cliPath, 'run', 'demo:build'], {
    cwd: root,
    encoding: 'utf8'
  })

  assert.equal(result.status, 1)
  assert.match(result.stderr, /No Isox workspace found.*Add isox.json/)
})

for (const executor of ['@isox-sh/core:run-command', 'core:run-command', '@isox-sh/core:run-commands', 'core:run-commands']) {
  test(`CLI runs ${executor} without core installed in the workspace`, async (t) => {
    const { root, write } = await fixture(t)

    await write('isox.json', {})
    await write('apps/demo/project.json', {
      name: 'demo',
      targets: {
        build: {
          executor,
          options: {
            commands: ['node build.cjs', { command: 'node verify.cjs' }],
            parallel: false
          }
        }
      },
    })
    await write('build.cjs', "require('node:fs').writeFileSync('result.txt', 'built')")
    await write('verify.cjs', "require('node:assert/strict').equal(require('node:fs').readFileSync('result.txt', 'utf8'), 'built'); require('node:fs').writeFileSync('verified.txt', 'verified')")
    assert.throws(() => require.resolve('@isox-sh/core/package.json', { paths: [root] }), { code: 'MODULE_NOT_FOUND' })
    const result = spawnSync(process.execPath, [cliPath, 'build', 'demo'], {
      cwd: join(root, 'apps/demo'),
      encoding: 'utf8',
    })

    assert.equal(result.status, 0, result.stderr)
    assert.equal(await readFile(join(root, 'result.txt'), 'utf8'), 'built')
    assert.equal(await readFile(join(root, 'verified.txt'), 'utf8'), 'verified')
  })
}

test('CLI prefers workspace core and reports invalid manifests without falling back', async (t) => {
  const { root, write } = await fixture(t)

  await write('isox.json', {})
  await write('project.json', {
    name: 'demo',
    targets: { build: { executor: '@isox-sh/core:run-command' } },
  })
  await write('node_modules/@isox-sh/core/package.json', {
    name: '@isox-sh/core',
    executors: './executors.json'
  })
  await write('node_modules/@isox-sh/core/executors.json', { executors: { 'run-command': { implementation: './run.cjs' } } })
  await write('node_modules/@isox-sh/core/run.cjs', `module.exports = () => {
    console.log('workspace core selected')
    return { success: true }
  }`)
  const result = spawnSync(process.execPath, [cliPath, 'build', 'demo'], {
    cwd: root,
    encoding: 'utf8'
  })

  assert.equal(result.status, 0, result.stderr)
  assert.match(result.stdout, /workspace core selected/)

  await write('node_modules/@isox-sh/core/package.json', { name: '@isox-sh/core' })
  const invalid = spawnSync(process.execPath, [cliPath, 'build', 'demo'], {
    cwd: root,
    encoding: 'utf8'
  })

  assert.equal(invalid.status, 1)
  assert.match(invalid.stderr, /Package @isox-sh\/core does not define an executors manifest/)
})

test('CLI verbose mode enables diagnostics and error stacks', async (t) => {
  const { root } = await executorFixture(t, `
    module.exports = async (options, context) => {
      require('node:assert/strict').equal(context.verbose, process.argv.includes('--verbose'))
      throw new Error('fixture failure')
    }
  `)

  for (const command of [['run', 'demo:build'], ['build', 'demo']]) {
    for (const verbose of [false, true]) {
      const args = [cliPath, ...command, ...(verbose ? ['--verbose'] : [])]
      const result = spawnSync(process.execPath, args, {
        cwd: root,
        encoding: 'utf8'
      })

      assert.equal(result.status, 1)
      assert.match(result.stderr, /fixture failure/)
      assert.equal((result.stderr.match(/fixture failure/g) ?? []).length, 1)
      assert.doesNotMatch(result.stdout, /Successfully completed/)

      if (verbose) {
        assert.match(result.stdout, /Workspace root:/)
        assert.match(result.stdout, /Resolved @fixture\/plugin:build/)
        assert.match(result.stderr, /executor\.cjs/)
      } else {
        assert.doesNotMatch(result.stdout, /Workspace root:|Resolved/)
        assert.doesNotMatch(result.stderr, /executor\.cjs/)
      }
    }
  }
})

test('CLI runs from root and nested directories with workspace options and context', async (t) => {
  const { root } = await executorFixture(t, `
    const assert = require('node:assert/strict')
    exports.default = async (options, context) => {
      assert.equal(options.answer, 42)
      assert.equal(context.workspaceRoot, process.cwd())
      assert.equal(context.projectRoot, require('node:path').join(process.cwd(), 'apps/demo'))
      assert.ok(require('node:fs').statSync('isox.json').isFile())
      assert.equal(context.projectName, 'demo')
      assert.equal(context.commandName, 'build')
      assert.equal(context.command.executor, '@fixture/plugin:build')
      assert.equal(context.workspace.projects.demo.targets.build.options.answer, 42)
      assert.deepEqual(context.workspace.projects.demo.dependencies, [])
      assert.equal(context.workspace.projects.demo.root, 'apps/demo')
      assert.equal(context.project, context.workspace.projects.demo)
      assert.deepEqual(context.project.custom, { owner: 'demo-team' })
      assert.deepEqual(context.command.custom, { region: 'eu' })
      assert.equal(context.command, context.project.targets.build)
      assert.equal(typeof context.logger.info, 'function')
      for (const key of ['root', 'cwd', 'targetName', 'target', 'projectsConfigurations', 'isVerbose']) {
        assert.equal(Object.hasOwn(context, key), false)
      }
      assert.equal(Object.hasOwn(context.project, 'executors'), false)
      assert.equal(context.verbose, false)
      return { success: true }
    }
  `)
  const nestedDirectory = join(root, 'apps/other/src')

  await mkdir(nestedDirectory, { recursive: true })
  for (const command of [['run', 'demo:build'], ['build', 'demo']]) {
    for (const cwd of [root, nestedDirectory]) {
      const result = spawnSync(process.execPath, [cliPath, ...command], {
        cwd,
        encoding: 'utf8'
      })

      assert.equal(result.status, 0, result.stderr)
      assert.match(result.stdout, /Successfully completed/)
    }
  }
})

test('CLI reports input and task failures with a nonzero exit code', async (t) => {
  const { root } = await executorFixture(t, 'module.exports = async () => ({ success: false })')

  for (const [args, message] of [
    [['run', 'demo'], /Invalid target format/],
    [['run', 'demo:build:extra'], /Invalid target format/],
    [['run', 'missing:build'], /Project missing not found/],
    [['run', 'demo:missing'], /Command missing not found/],
    [['run', 'demo:toString'], /Command toString not found/],
    [['run', 'demo:build'], /Task failed for demo/],
    [['run'], /missing required args/],
    [['run', 'demo:build', '--invalid'], /Task failed for demo/],
    [['build'], /missing required args/],
    [['build', 'demo', 'extra'], /Unused args/],
    [['build', 'missing'], /Project missing not found/],
    [['missing', 'demo'], /Command missing not found/],
    [['toString', 'demo'], /Command toString not found/],
    [['build', 'demo'], /Task failed for demo/],
    [['build', 'demo', '--invalid'], /Task failed for demo/],
    [['bad:command', 'demo'], /Invalid command or project name/],
    [['build', 'bad:project'], /Invalid command or project name/],
    [['reset', 'demo'], /Unused args/],
  ]) {
    const result = spawnSync(process.execPath, [cliPath, ...args], {
      cwd: root,
      encoding: 'utf8'
    })

    assert.equal(result.status, 1, result.stderr)
    assert.match(result.stderr, message)
    assert.doesNotMatch(result.stdout, /Successfully completed/)
  }
})

test('CLI shorthand supports custom commands and leading global options', async (t) => {
  const { root, write } = await executorFixture(t, `
    module.exports = async (options, context) => {
      const assert = require('node:assert/strict')
      assert.equal(context.commandName, 'check-types')
      assert.equal(context.verbose, true)
      assert.equal(options.answer, 42)
      return { success: true }
    }
  `)

  await write('apps/demo/project.json', {
    name: 'demo',
    targets: {
      'check-types': {
        executor: '@fixture/plugin:build',
        options: { answer: 42 }
      },
    },
  })
  const result = spawnSync(process.execPath, [cliPath, '--verbose', 'check-types', 'demo'], {
    cwd: root,
    encoding: 'utf8',
  })

  assert.equal(result.status, 0, result.stderr)
  assert.match(result.stdout, /Successfully completed/)
  assert.match(result.stdout, /Workspace root:/)
})

test('CLI provides help', () => {
  for (const args of [[], ['--help'], ['build', '--help']]) {
    const result = spawnSync(process.execPath, [cliPath, ...args], { encoding: 'utf8' })

    assert.equal(result.status, 0, result.stderr)
    assert.match(result.stdout, /<command> <target>/)
    assert.match(result.stdout, /run <target>/)
    assert.match(result.stdout, /isox build cli/)
  }
})

for (const executor of ['core:run-command', '@isox-sh/core:run-commands']) {
  test(`${executor} configurations and CLI overrides replace the inherited command shape`, async t => {
    const { root, write } = await fixture(t)
    await write('isox.json', {})
    await write('project.json', {
      name: 'demo',
      targets: {
        single: {
          executor,
          options: { command: 'node record.cjs base' },
          configurations: { array: { commands: ['node record.cjs array'] } }
        },
        multi: {
          executor,
          options: { commands: ['node record.cjs base'] },
          configurations: { single: { command: 'node record.cjs single' } }
        },
      }
    })
    await write('record.cjs', "require('node:fs').writeFileSync('result.txt', process.argv[2])")
    for (const [args, expected] of [
      [['single', 'demo', '--config=array'], 'array'],
      [['multi', 'demo', '--config=single'], 'single'],
      [['single', 'demo', '--options=' + JSON.stringify({ commands: ['node record.cjs cli-array'] })], 'cli-array'],
      [['multi', 'demo', '--options=' + JSON.stringify({ command: 'node record.cjs cli-single' })], 'cli-single'],
    ]) {
      const result = spawnSync(process.execPath, [cliPath, ...args], {
        cwd: root,
        encoding: 'utf8'
      })
      assert.equal(result.status, 0, result.stderr)
      assert.equal(await readFile(join(root, 'result.txt'), 'utf8'), expected)
    }
  })
}

test('migrate accepts bare and explicit plan options from nested directories', async t => {
  const { root, write } = await fixture(t)
  await write('isox.json', {})
  await write('migrations.json', { migrations: [] })
  await write('plans/custom.json', { migrations: [] })
  for (const args of [
    ['--run-migrations'],
    ['--run-migrations=plans/custom.json'],
    ['--run-migrations', 'plans/custom.json'],
    ['--run-migrations=missing.json', '--if-exists'],
  ]) {
    const result = spawnSync(process.execPath, [cliPath, 'migrate', ...args], {
      cwd: join(root, 'plans'),
      encoding: 'utf8'
    })
    assert.equal(result.status, 0, result.stderr)
  }

  for (const args of [[], ['latest', '--run-migrations'], ['latest', '--if-exists'], ['--unknown']]) {
    const result = spawnSync(process.execPath, [cliPath, 'migrate', ...args], {
      cwd: root,
      encoding: 'utf8'
    })
    assert.equal(result.status, 1)
  }
})

test.skipIf(process.platform === 'win32')('migrate resolves registry metadata and collects published migration definitions', async t => {
  const { root, write } = await fixture(t)
  await write('isox.json', {})
  await write('package.json', { devDependencies: { '@isox-sh/core': '~1.0.0' } })
  await write('node_modules/@isox-sh/core/package.json', { version: '1.0.0' })
  await write('bin/npm', `#!${process.execPath}
const fs = require('node:fs')
const path = require('node:path')
const assert = require('node:assert/strict')
const args = process.argv.slice(2)
if (args[0] === 'view') {
  assert.deepEqual(args, ['view', '@isox-sh/core@latest', '--json'])
  console.log(JSON.stringify({ version: '2.0.0', migrations: './migrations.json' }))
} else {
  assert.ok(args.includes('--ignore-scripts'))
  assert.equal(args.at(-1), '@isox-sh/core@2.0.0')
  const temporary = args[args.indexOf('--prefix') + 1]
  fs.writeFileSync('temporary-path', temporary)
  const root = path.join(temporary, 'node_modules/@isox-sh/core')
  fs.mkdirSync(root, { recursive: true })
  fs.writeFileSync(path.join(root, 'package.json'), JSON.stringify({ version: '2.0.0', migrations: './migrations.json' }))
  fs.writeFileSync(path.join(root, 'migrations.json'), JSON.stringify({ migrations: { update: { version: '2.0.0', implementation: './update.js' } } }))
}
`)
  await require('node:fs/promises').chmod(join(root, 'bin/npm'), 0o755)
  const result = spawnSync(process.execPath, [cliPath, 'migrate', 'latest'], {
    cwd: root,
    encoding: 'utf8',
    env: {
      ...process.env,
      PATH: `${join(root, 'bin')}${require('node:path').delimiter}${process.env.PATH}`
    },
  })
  assert.equal(result.status, 0, result.stderr)
  const plan = JSON.parse(await readFile(join(root, 'migrations.json'), 'utf8'))
  assert.deepEqual(plan.migrations, [{
    package: '@isox-sh/core',
    name: 'update',
    version: '2.0.0'
  }])
  assert.equal(JSON.parse(await readFile(join(root, 'package.json'), 'utf8')).devDependencies['@isox-sh/core'], '~2.0.0')
  const temporary = await readFile(join(root, 'temporary-path'), 'utf8')
  await assert.rejects(require('node:fs/promises').stat(temporary), { code: 'ENOENT' })
})
