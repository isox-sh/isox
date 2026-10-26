import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { chmod, cp, mkdir, mkdtemp, readdir, readFile, rm, stat, symlink, truncate, writeFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'

import { test } from 'vitest'

const require = createRequire(import.meta.url)
const { createLogger, runExecutor, resetWorkspace } = require('../../../dist/core')
const { taskHash } = require('../../../dist/core/cache/hash')
const { storeTask, restoreTask } = require('../../../dist/core/cache/store')
const { parseProjectDefinition } = require('../../../dist/core/workspace/configuration')

const executor = String.raw`module.exports = async (options, context) => {
  const fs = require('node:fs/promises')
  const path = require('node:path')
  const root = context.workspaceRoot
  await fs.appendFile(path.join(root, 'runs'), 'run\n')
  await fs.mkdir(path.join(root, 'dist/demo/empty'), { recursive: true })
  await fs.writeFile(path.join(root, 'dist/demo/file'), await fs.readFile(path.join(root, 'apps/demo/input.txt')))
  await fs.chmod(path.join(root, 'dist/demo/file'), 0o755)
  process.stdout.write('task stdout\n')
  process.stderr.write('task stderr\n')
  return { success: true }
}`

async function fixture(t, source = executor) {
  const root = await mkdtemp(join(tmpdir(), 'isox-task-cache-'))

  t.onTestFinished(() => rm(root, {
    recursive: true,
    force: true
  }))
  const write = async (file, data) => {
    await mkdir(dirname(join(root, file)), { recursive: true })
    await writeFile(join(root, file), typeof data === 'string' ? data : JSON.stringify(data))
  }

  const pkg = join(root, 'node_modules/@fixture/plugin/package.json')
  const command = {
    executor: '@fixture/plugin:build',
    cache: true,
    outputs: ['dist/demo'],
    inputs: ['{projectRoot}/**/*', '{workspaceRoot}/shared.txt', { env: 'ISOX_TEST_CACHE_VALUE' }],
    options: {
      a: 1,
      b: {
        x: 2,
        y: 3
      }
    },
    configurations: { production: { mode: 'production' } }
  }
  const workspace = {
    projects: {
      demo: {
        name: 'demo',
        root: 'apps/demo',
        dependencies: ['lib'],
        targets: { build: command }
      },
      lib: {
        name: 'lib',
        root: 'libs/lib',
        targets: { build: { executor: '@fixture/plugin:build' } }
      },
    }
  }
  const logs = []
  const logger = createLogger({
    level: 4,
    reporters: [{ log: entry => logs.push(entry.args.join(' ')) }]
  })
  const context = {
    workspaceRoot: root,
    projectRoot: join(root, 'apps/demo'),
    projectName: 'demo',
    commandName: 'build',
    project: workspace.projects.demo,
    command,
    workspace,
    logger,
    verbose: false,
  }

  await write('isox.json', {})
  await write('apps/demo/input.txt', 'first')
  await write('libs/lib/input.txt', 'dependency')
  await write('node_modules/@fixture/plugin/package.json', {
    name: '@fixture/plugin',
    version: '1.0.0',
    executors: './executors.json'
  })
  await write('node_modules/@fixture/plugin/executors.json', { executors: { build: { implementation: './build.cjs' } } })
  await write('node_modules/@fixture/plugin/build.cjs', source)

  return {
    root,
    write,
    pkg,
    command,
    workspace,
    logs,
    context,
    run: (overrides = {}, configuration, signal, controls) => runExecutor(workspace, 'demo', 'build', root, logger, configuration, signal, overrides, controls),
    hash: () => taskHash(context, command.options, pkg),
    entries: async () => (await readdir(join(root, '.isox/tasks'))).filter(name => /^[a-f0-9]{64}$/.test(name)),
    runs: async () => (await readFile(join(root, 'runs'), 'utf8')).trim().split('\n').length,
  }
}

test('native caching is opt-in and validates declarations', () => {
  const build = { executor: 'core:run-command' }

  for (const invalid of [
    {
      cache: 'yes',
      outputs: []
    }, {
      cache: true,
      outputs: [1]
    },
    { inputs: [{ runtime: 'node' }] }, { inputs: [{ env: '' }] }, { inputs: 'src/**' }
  ]) {
    assert.throws(() => parseProjectDefinition({
      targets: {
        build: {
          ...build,
          ...invalid
        }
      }
    }, 'project.json'), /Invalid project/)
  }

  assert.ok(parseProjectDefinition({
    targets: {
      build: {
        ...build,
        cache: true,
        outputs: []
      }
    }
  }, 'project.json'))
  const migrated = parseProjectDefinition({
    $schema: 'nx/schemas/project-schema.json',
    targets: {
      build: {
        ...build,
        cache: true,
        inputs: ['production', '^production', { externalDependencies: ['typescript'] }],
        outputs: ['{options.outputPath}']
      }
    }
  }, 'project.json')

  assert.equal(migrated.targets.build.cache, undefined)
  assert.equal(migrated.targets.build.inputs, undefined)
  assert.deepEqual(migrated.targets.build.outputs, ['{options.outputPath}'])
})

test('restores outputs, empty directories, executable modes and terminal logs; removes stale files', async t => {
  const f = await fixture(t)

  await f.run()
  assert.equal(await f.runs(), 1)
  assert.equal((await f.entries()).length, 1)
  await f.write('dist/demo/stale', 'stale')
  await f.write('dist/demo/file', 'modified')
  await f.run()
  assert.equal(await f.runs(), 1)
  assert.equal(await readFile(join(f.root, 'dist/demo/file'), 'utf8'), 'first')
  assert.deepEqual((await readdir(join(f.root, 'dist/demo'))).sort(), ['empty', 'file'])

  if (process.platform !== 'win32') {
    assert.equal((await stat(join(f.root, 'dist/demo/file'))).mode & 0o777, 0o755)
  }

  assert.ok(f.logs.some(log => log.includes('Cache hit')))
  const entry = JSON.parse(await readFile(join(f.root, '.isox/tasks', (await f.entries())[0], 'entry.json'), 'utf8'))

  assert.match(entry.logs.map(chunk => Buffer.from(chunk.data, 'base64').toString()).join(''), /task stdout/)
  assert.ok(entry.logs.some(chunk => chunk.stream === 'stderr'))
  await rm(join(f.root, 'dist'), { recursive: true })
  await f.run()
  assert.equal(await f.runs(), 1)
  assert.equal(await readFile(join(f.root, 'dist/demo/file'), 'utf8'), 'first')
})

test('stable keys ignore JSON property ordering and output content but track all declared inputs', async t => {
  const f = await fixture(t)
  const original = await f.hash()

  f.command.options = {
    b: {
      y: 3,
      x: 2
    },
    a: 1
  }
  assert.equal(await f.hash(), original)
  await f.write('dist/demo/ignored', 'generated')
  await f.write('.isox/ignored', 'state')
  await f.write('node_modules/irrelevant/file', 'installed')
  assert.equal(await f.hash(), original)

  for (const [file, content] of [
    ['apps/demo/input.txt', 'changed'], ['libs/lib/input.txt', 'dep changed'],
    ['shared.txt', 'created missing literal'], ['pnpm-lock.yaml', 'lockfile'],
    ['package.json', '{}'], ['tsconfig.base.json', '{}'],
    ['apps/demo/.hidden', 'hidden'], ['apps/demo/ignored.log', 'gitignored content'],
    ['node_modules/@fixture/plugin/build.cjs', `${executor}\n// changed implementation`],
    ['node_modules/@fixture/plugin/package.json', {
      version: '2.0.0',
      executors: './executors.json'
    }],
  ]) {
    const before = await f.hash()

    await f.write(file, content)
    assert.notEqual(await f.hash(), before, file)
  }

  const before = await f.hash()

  f.command.options.a = 2
  assert.notEqual(await f.hash(), before)
  const beforeEnv = await f.hash()
  const old = process.env.ISOX_TEST_CACHE_VALUE

  try {
    process.env.ISOX_TEST_CACHE_VALUE = 'changed'
    assert.notEqual(await f.hash(), beforeEnv)
  } finally {
    if (old === undefined) {
      delete process.env.ISOX_TEST_CACHE_VALUE
    } else {
      process.env.ISOX_TEST_CACHE_VALUE = old
    }
  }

  const beforeDelete = await f.hash()

  await rm(join(f.root, 'shared.txt'))
  assert.notEqual(await f.hash(), beforeDelete)

  if (process.platform !== 'win32') {
    const beforeMode = await f.hash()

    await chmod(join(f.root, 'apps/demo/input.txt'), 0o755)
    assert.notEqual(await f.hash(), beforeMode)
  }
})

test('exclusions avoid hashing generated files and outside-project declarations participate', async t => {
  const f = await fixture(t)

  f.command.inputs.push('!{projectRoot}/temp/**')
  const before = await f.hash()

  await f.write('apps/demo/temp/cache', 'ignored')
  // The explicitly excluded directory itself is also omitted.
  f.command.inputs.push('!{projectRoot}/temp')
  const excluded = await f.hash()

  await f.write('apps/demo/temp/cache', 'different')
  assert.equal(await f.hash(), excluded)
  assert.notEqual(excluded, before, 'changing declarations changes the key')
  await f.write('shared.txt', 'shared configuration')
  assert.notEqual(await f.hash(), excluded)
})

test('trailing directory separators preserve input matching and output exclusion', async t => {
  const f = await fixture(t)

  f.command.inputs = ['{projectRoot}/', 'dist/', '!{projectRoot}/scratch/']
  f.command.outputs = ['dist/demo/']
  const before = await f.hash()

  await f.write('apps/demo/scratch/ignored.txt', 'ignored')
  assert.equal(await f.hash(), before)
  await f.write('apps/demo/input.txt', 'updated')
  assert.notEqual(await f.hash(), before)
  await f.run()
  await f.run()
  assert.equal(await f.runs(), 1)
  assert.equal(await readFile(join(f.root, 'dist/demo/file'), 'utf8'), 'updated')
})

test('effective configurations and overrides get separate entries; bypass skips reads and writes', async t => {
  const f = await fixture(t)

  await f.run()
  await f.run({ custom: 1 })
  await f.run({}, 'production')
  assert.equal(await f.runs(), 3)
  assert.equal((await f.entries()).length, 3)
  await f.run({}, undefined, undefined, { skipCache: true })
  assert.equal(await f.runs(), 4)
  assert.equal((await f.entries()).length, 3)
  await f.run()
  assert.equal(await f.runs(), 4)
  await resetWorkspace(f.root)
  await assert.rejects(stat(join(f.root, '.isox')), { code: 'ENOENT' })
})

for (const source of [
  executor.replace('success: true', 'success: false'),
  executor.replace('return { success: true }', 'throw new Error("failed")'),
  'module.exports = async function* () {}',
  'module.exports = async function* () { yield { success: true }; yield { success: false } }',
]) {
  test(`failed tasks cannot publish a result: ${source.slice(-70)}`, async t => {
    const f = await fixture(t, source)

    await assert.rejects(f.run())
    assert.deepEqual(await f.entries(), [])
  })
}

test('cancelled and continuous tasks are never stored', async t => {
  const continuous = await fixture(t, 'module.exports = async function* () { yield { success: true, continuous: true } }')

  await continuous.run()
  assert.deepEqual(await continuous.entries(), [])
  const single = await fixture(t, 'module.exports = () => ({ success: true, continuous: true })')

  await single.run()
  assert.deepEqual(await single.entries(), [])
  const f = await fixture(t, `module.exports = async (_, context) => {
    process.emit('isox-cache-test-start')
    await require('node:timers/promises').setTimeout(10000, undefined, { signal: context.signal })
    return { success: true }
  }`)
  const controller = new AbortController()
  const cancel = () => controller.abort()

  process.once('isox-cache-test-start', cancel)
  t.onTestFinished(() => process.off('isox-cache-test-start', cancel))
  await f.run({}, undefined, controller.signal)
  assert.deepEqual(await f.entries(), [])
})

test('source mutation during execution prevents cache publication', async t => {
  const f = await fixture(t, executor.replace('return { success: true }', `await fs.writeFile(path.join(root, 'apps/demo/input.txt'), 'mutated')
    return { success: true }`))

  await f.run()
  assert.deepEqual(await f.entries(), [])
})

for (const corruption of ['metadata', 'artifact', 'missing']) {
  test(`corrupt ${corruption} causes execution instead of reuse`, async t => {
    const f = await fixture(t)

    await f.run()
    const key = (await f.entries())[0]
    const base = `.isox/tasks/${key}`

    if (corruption === 'metadata') {
      await f.write(`${base}/entry.json`, '{partial')
    } else if (corruption === 'artifact') {
      await f.write(`${base}/0/file`, 'wrong')
    } else {
      await rm(join(f.root, base, '0/file'))
    }

    await f.run()
    assert.equal(await f.runs(), 2)
    await f.run()
    assert.equal(await f.runs(), 2)
  })
}

test('rejects unsafe output boundaries before executing or deleting anything', async t => {
  const f = await fixture(t)

  for (const output of ['.', '../escape', '/tmp/out', '.isox', 'node_modules/out', '.GIT', 'apps', 'libs/lib/tmp', 'apps/demo', 'dist/*']) {
    f.command.outputs = [output]
    await assert.rejects(f.run(), /output|path/i)
    assert.equal(await readFile(join(f.root, 'apps/demo/input.txt'), 'utf8'), 'first')
  }

  f.command.outputs = ['dist/demo', 'dist/demo/subdir']
  await assert.rejects(f.run(), /overlaps/)
  f.command.outputs = ['apps/demo/input.txt']
  await assert.rejects(f.run(), /directory/)
})

test.skipIf(process.platform === 'win32')('rejects symlink inputs, artifacts and output parents', async t => {
  const f = await fixture(t)

  await symlink(join(f.root, 'shared.txt'), join(f.root, 'apps/demo/link'))
  await assert.rejects(f.run(), /regular files|Symlinks/)
  await rm(join(f.root, 'apps/demo/link'))
  await mkdir(join(f.root, 'elsewhere'))
  await symlink(join(f.root, 'elsewhere'), join(f.root, 'dist'))
  await assert.rejects(f.run(), /Symlinks/)
  assert.deepEqual(await readdir(join(f.root, 'elsewhere')), [])
})

test('concurrent publication leaves one complete entry and no temporary directories', async t => {
  const f = await fixture(t)

  await f.write('dist/demo/file', 'complete')
  const hash = await f.hash()

  await Promise.all(Array.from({ length: 4 }, () => storeTask(f.context, hash, ['dist/demo'], [], 1, async () => true)))
  assert.deepEqual(await f.entries(), [hash])
  assert.deepEqual(await readdir(join(f.root, '.isox/tasks')), [hash])
  await rm(join(f.root, 'dist'), { recursive: true })
  assert.deepEqual(await restoreTask(f.context, hash, ['dist/demo']), [])
  assert.equal(await readFile(join(f.root, 'dist/demo/file'), 'utf8'), 'complete')
})

test('installed tool version and runtime changes invalidate keys independently of the lockfile', async t => {
  const f = await fixture(t)

  await f.write('node_modules/@fixture/plugin/package.json', {
    name: '@fixture/plugin',
    version: '1.0.0',
    executors: './executors.json',
    dependencies: { compiler: '*' }
  })
  const absent = await f.hash()

  await f.write('node_modules/compiler/package.json', {
    name: 'compiler',
    version: '1.0.0'
  })
  const installed = await f.hash()

  assert.notEqual(installed, absent)
  await f.write('node_modules/compiler/package.json', {
    name: 'compiler',
    version: '2.0.0'
  })
  assert.notEqual(await f.hash(), installed)
  await f.write('apps/demo/package.json', {
    name: 'demo',
    dependencies: { compiler: '*' }
  })
  await f.write('apps/demo/node_modules/compiler/package.json', {
    name: 'compiler',
    version: '3.0.0'
  })
  const projectTool = await f.hash()

  await f.write('apps/demo/node_modules/compiler/package.json', {
    name: 'compiler',
    version: '4.0.0'
  })
  assert.notEqual(await f.hash(), projectTool)
  const before = await f.hash()
  const descriptor = Object.getOwnPropertyDescriptor(process, 'version')

  try {
    Object.defineProperty(process, 'version', {
      ...descriptor,
      value: 'v99.0.0'
    })
    assert.notEqual(await f.hash(), before)
  } finally {
    Object.defineProperty(process, 'version', descriptor)
  }
})

test('inputs changed while preparing a hit leave current outputs untouched', async t => {
  const f = await fixture(t)

  await f.run()
  const hash = (await f.entries())[0]

  await f.write('dist/demo/file', 'current')
  assert.equal(await restoreTask(f.context, hash, ['dist/demo'], async () => false), undefined)
  assert.equal(await readFile(join(f.root, 'dist/demo/file'), 'utf8'), 'current')
})

test('missing outputs and log-only tasks have valid reusable results', async t => {
  const f = await fixture(t, 'module.exports = () => ({ success: true })')

  await f.run()
  await f.write('dist/demo/stale', 'old')
  await f.run()
  await assert.rejects(stat(join(f.root, 'dist/demo')), { code: 'ENOENT' })
  assert.ok(f.logs.some(log => log.includes('Cache hit')))
  f.command.outputs = []
  await f.run()
  await f.run()
  assert.equal(f.logs.filter(log => log.includes('Cache hit')).length, 2)
  delete f.command.outputs
  await f.run()
  await f.run()
  assert.equal(f.logs.filter(log => log.includes('Cache hit')).length, 3)
})

test('claims reject overlapping tasks while allowing independent outputs', async t => {
  const { claimOutputs } = require('../../../dist/core/cache/store')
  const f = await fixture(t)
  const release = await claimOutputs(f.root, ['dist/demo'])

  try {
    await assert.rejects(claimOutputs(f.root, ['dist/demo/nested']), /overlapping outputs/)
    await assert.rejects(claimOutputs(f.root, ['dist']), /overlapping outputs/)
    const other = await claimOutputs(f.root, ['dist/other'])

    await other()
  } finally {
    await release()
  }

  assert.deepEqual(await readdir(join(f.root, '.isox/tasks/locks')), [])
})

test('terminal capture isolates concurrent tasks and bounds log memory', async () => {
  const { captureOutput } = require('../../../dist/core/cache/output')
  const stdout = process.stdout.write
  const stderr = process.stderr.write

  process.stdout.write = () => true
  process.stderr.write = () => true

  try {
    const [a, b] = await Promise.all(['a', 'b'].map(value => captureOutput(async () => {
      process.stdout.write(value)
      await new Promise(resolve => setTimeout(resolve, 5))
      process.stderr.write(value)
    })))
    const text = captured => captured.chunks.map(chunk => Buffer.from(chunk.data, 'base64').toString()).join('')

    assert.equal(text(a), 'aa')
    assert.equal(text(b), 'bb')
    const oversized = await captureOutput(async () => {
      process.stdout.write(Buffer.alloc(16 * 1024 * 1024 + 1))
    })

    assert.equal(oversized.complete, false)
    assert.deepEqual(oversized.chunks, [])

    const tinyWrites = await captureOutput(async () => {
      for (let index = 0; index < 65_537; index++) {
        process.stdout.write('x')
      }
    })

    assert.equal(tinyWrites.complete, false)
    assert.deepEqual(tinyWrites.chunks, [])
    const emptyWrites = await captureOutput(async () => {
      for (let index = 0; index < 65_537; index++) {
        process.stdout.write('')
      }
    })

    assert.equal(emptyWrites.complete, true)
    assert.deepEqual(emptyWrites.chunks, [])
  } finally {
    process.stdout.write = stdout
    process.stderr.write = stderr
  }
})

test('nested captures retain child output in the parent without mixing siblings', async () => {
  const { captureOutput } = require('../../../dist/core/cache/output')
  const stdout = process.stdout.write
  const stderr = process.stderr.write

  process.stdout.write = () => true
  process.stderr.write = () => true

  try {
    let children
    const parent = await captureOutput(async () => {
      process.stdout.write('before')
      children = await Promise.all(['a', 'b'].map(value => captureOutput(async () => {
        await new Promise(resolve => setImmediate(resolve))
        process.stderr.write(value)
      })))
      process.stdout.write('after')
    })
    const text = captured => captured.chunks.map(chunk => Buffer.from(chunk.data, 'base64').toString()).join('')

    assert.equal(text(parent), 'beforeabafter')
    assert.deepEqual(children.map(text), ['a', 'b'])
    assert.deepEqual(parent.chunks.map(chunk => chunk.stream), ['stdout', 'stderr', 'stderr', 'stdout'])
  } finally {
    process.stdout.write = stdout
    process.stderr.write = stderr
  }
})

test('large valid terminal chunks survive cache validation', async t => {
  const f = await fixture(t)
  const logs = [{
    stream: 'stdout',
    data: Buffer.alloc(8 * 1024 * 1024, 'x').toString('base64')
  }]
  const hash = await f.hash()

  await storeTask(f.context, hash, [], logs, 1, async () => true)
  assert.deepEqual(await restoreTask(f.context, hash, []), logs)
  assert.equal(f.logs.some(log => log.includes('corrupt')), false)
})

test('dependency artifacts invalidate consumers and generated inputs can be declared explicitly', async t => {
  const f = await fixture(t)

  f.workspace.projects.lib.targets.build.cache = true
  f.workspace.projects.lib.targets.build.outputs = ['dist/lib']
  const before = await f.hash()

  await f.write('dist/lib/index.js', 'first build')
  const built = await f.hash()

  assert.notEqual(built, before)
  await f.write('dist/lib/index.js', 'rebuilt without source changes')
  assert.notEqual(await f.hash(), built)
  f.command.inputs.push('dist/other/**/*')
  const explicit = await f.hash()

  await f.write('dist/other/index.js', 'other generated input')
  assert.notEqual(await f.hash(), explicit)
})

for (const option of ['watch', 'dryRun']) {
  test(`${option} bypasses reads and writes even for a finite executor`, async t => {
    const f = await fixture(t)

    await f.run()
    await f.run({ [option]: true })
    await f.run({ [option]: true })
    assert.equal(await f.runs(), 3)
    assert.equal((await f.entries()).length, 1)
  })
}

test('a literal workspace-root input includes files beneath it', async t => {
  const f = await fixture(t)

  f.command.inputs = ['{workspaceRoot}']
  const before = await f.hash()

  await f.write('root-input.txt', 'changed')
  assert.notEqual(await f.hash(), before)
})

test.skipIf(process.platform !== 'darwin' && process.platform !== 'win32')('alternate casing cannot overwrite a project root', async t => {
  const f = await fixture(t)

  f.command.outputs = ['APPS/DEMO']
  await assert.rejects(f.run(), /overlaps/)
  assert.equal(await readFile(join(f.root, 'apps/demo/input.txt'), 'utf8'), 'first')
})

test('projectName tokens use the configured name for cache inputs and outputs', async t => {
  const f = await fixture(t)

  f.command.inputs = ['apps/{projectName}/**/*', '{workspaceRoot}/shared-{projectName}.txt']
  f.command.outputs = ['{workspaceRoot}/dist/{projectName}']
  await f.run()
  await rm(join(f.root, 'dist'), { recursive: true })
  await f.run()
  assert.equal(await f.runs(), 1)
  await f.write('shared-demo.txt', 'changed')
  await f.run()
  assert.equal(await f.runs(), 2)
})

for (const controls of [{}, { skipCache: true }]) {
  test(`failed builds restore previous outputs, including bypass=${!!controls.skipCache}`, async t => {
    const f = await fixture(t, executor.replace('success: true', 'success: false'))

    await f.write('dist/demo/file', 'previous build')
    await f.write('dist/demo/keep', 'previous asset')
    await assert.rejects(f.run({}, undefined, undefined, controls), /Task failed/)
    assert.equal(await readFile(join(f.root, 'dist/demo/file'), 'utf8'), 'previous build')
    assert.equal(await readFile(join(f.root, 'dist/demo/keep'), 'utf8'), 'previous asset')
    assert.deepEqual((await readdir(join(f.root, 'dist/demo'))).sort(), ['file', 'keep'])
    assert.deepEqual(await f.entries(), [])
    assert.deepEqual(await readdir(join(f.root, '.isox/tasks')), ['locks'])
  })
}

test('cancelled builds restore previous outputs and remove newly created output directories', async t => {
  const f = await fixture(t, executor.replace('return { success: true }', `
    await fs.mkdir(path.join(root, 'dist/new'), { recursive: true })
    await fs.writeFile(path.join(root, 'dist/new/file'), 'partial')
    process.emit('isox-cache-test-cancel')
    return { success: true }
  `))
  const controller = new AbortController()
  const cancel = () => controller.abort()

  f.command.outputs.push('dist/new')
  process.once('isox-cache-test-cancel', cancel)
  t.onTestFinished(() => process.off('isox-cache-test-cancel', cancel))
  await f.write('dist/demo/file', 'previous build')
  await f.run({}, undefined, controller.signal)
  assert.equal(await readFile(join(f.root, 'dist/demo/file'), 'utf8'), 'previous build')
  await assert.rejects(stat(join(f.root, 'dist/new')), { code: 'ENOENT' })
  assert.deepEqual(await f.entries(), [])
})

for (const cached of [false, true]) {
  test(`Git-tracked output files survive a cache ${cached ? 'hit' : 'miss'}`, async t => {
    const f = await fixture(t)

    if (cached) {
      await f.run()
    }

    await f.write('dist/demo/keep', 'tracked source')
    const env = Object.fromEntries(Object.entries(process.env).filter(([key]) => !key.startsWith('GIT_')))
    const git = (...args) => execFileSync('git', args, {
      cwd: f.root,
      env,
      stdio: 'pipe'
    })

    git('init')
    git('add', '--', 'dist/demo/keep')
    for (const controls of [{}, { skipCache: true }]) {
      await assert.rejects(f.run({}, undefined, undefined, controls), /Git-tracked files/)
      assert.equal(await readFile(join(f.root, 'dist/demo/keep'), 'utf8'), 'tracked source')
    }

    if (cached) {
      assert.equal(await f.runs(), 1)
    } else {
      await assert.rejects(readFile(join(f.root, 'runs')), { code: 'ENOENT' })
    }
  })
}

test('oversized cache metadata is ignored before reading it into memory', async t => {
  const f = await fixture(t)

  await f.run()
  const hash = (await f.entries())[0]

  await truncate(join(f.root, '.isox/tasks', hash, 'entry.json'), 64 * 1024 * 1024 + 1)
  await f.run()
  assert.equal(await f.runs(), 2)
  assert.ok(f.logs.some(log => log.includes('oversized task cache metadata')))
  await f.run()
  assert.equal(await f.runs(), 2)
})

test('the running core implementation participates in third-party executor keys', async t => {
  const f = await fixture(t)
  const runtime = join(f.root, 'runtime')

  await cp(resolve(import.meta.dirname, '../../../dist/core'), runtime, {
    recursive: true,
    filter: path => !path.split(/[\\/]/).includes('node_modules')
  })
  await symlink(resolve(import.meta.dirname, '../node_modules'), join(runtime, 'node_modules'), process.platform === 'win32' ? 'junction' : 'dir')
  const { taskHash: copiedHash } = require(join(runtime, 'cache/hash.js'))
  const before = await copiedHash(f.context, f.command.options, f.pkg)

  await f.write('runtime/cache/implementation-marker.js', '// changed core implementation')
  assert.notEqual(await copiedHash(f.context, f.command.options, f.pkg), before)
})

test.skipIf(process.platform === 'win32' || process.getuid?.() === 0)('a failed multi-directory restore rolls back directories already replaced', async t => {
  const f = await fixture(t)

  f.command.outputs.push('other/output')
  await f.write('dist/demo/file', 'cached')
  await f.write('other/output/file', 'cached second')
  const hash = await f.hash()

  await storeTask(f.context, hash, ['dist/demo', 'other/output'], [], 1, async () => true)
  await f.write('dist/demo/file', 'current')
  await f.write('other/output/file', 'current second')
  await chmod(join(f.root, 'other'), 0o555)

  try {
    await assert.rejects(restoreTask(f.context, hash, ['dist/demo', 'other/output']))
  } finally {
    await chmod(join(f.root, 'other'), 0o755)
  }

  assert.equal(await readFile(join(f.root, 'dist/demo/file'), 'utf8'), 'current')
  assert.equal(await readFile(join(f.root, 'other/output/file'), 'utf8'), 'current second')
})

test('tracked-output protection uses the workspace index even in nested workspaces with Git overrides', async t => {
  const f = await fixture(t)
  const { assertDisposableOutputs } = require('../../../dist/core/cache/safety')
  const env = Object.fromEntries(Object.entries(process.env).filter(([key]) => !key.startsWith('GIT_')))

  await f.write('nested/dist/demo/file', 'tracked')
  execFileSync('git', ['init'], {
    cwd: f.root,
    env,
    stdio: 'pipe'
  })
  execFileSync('git', ['add', '--', 'nested/dist/demo/file'], {
    cwd: f.root,
    env,
    stdio: 'pipe'
  })
  const previous = process.env.GIT_INDEX_FILE

  try {
    process.env.GIT_INDEX_FILE = join(f.root, 'empty-index')
    await assert.rejects(assertDisposableOutputs(join(f.root, 'nested'), ['dist/demo']), /Git-tracked files/)
  } finally {
    if (previous === undefined) {
      delete process.env.GIT_INDEX_FILE
    } else {
      process.env.GIT_INDEX_FILE = previous
    }
  }

  assert.equal(await readFile(join(f.root, 'nested/dist/demo/file'), 'utf8'), 'tracked')
})

test('failed execution rollback retains recoverable backups instead of deleting the last good output', async t => {
  const f = await fixture(t)
  const { prepareOutputs } = require('../../../dist/core/cache/store')

  await f.write('dist/demo/file', 'previous build')
  const transaction = await prepareOutputs(f.root, ['dist/demo'])

  await rm(join(f.root, 'dist'), { recursive: true })
  await f.write('dist', 'blocks recovery')
  await assert.rejects(transaction.rollback(), /Remaining backups/)
  const backup = (await readdir(join(f.root, '.isox/tasks'))).find(name => name.endsWith('.run'))

  assert.ok(backup)
  assert.deepEqual(JSON.parse(await readFile(join(f.root, '.isox/tasks', backup, 'outputs.json'), 'utf8')), ['dist/demo'])
  assert.equal(await readFile(join(f.root, '.isox/tasks', backup, '0/file'), 'utf8'), 'previous build')
  assert.equal(await readFile(join(f.root, 'dist'), 'utf8'), 'blocks recovery')
})

test.skipIf(process.platform === 'win32')('restore rechecks output paths after the input rehash', async t => {
  const f = await fixture(t)

  await f.run()
  const hash = (await f.entries())[0]

  await f.write('elsewhere/file', 'must survive')
  await assert.rejects(restoreTask(f.context, hash, ['dist/demo'], async () => {
    await rm(join(f.root, 'dist/demo'), { recursive: true })
    await symlink(join(f.root, 'elsewhere'), join(f.root, 'dist/demo'))

    return true
  }), /Symlinks/)
  assert.equal(await readFile(join(f.root, 'elsewhere/file'), 'utf8'), 'must survive')
})
