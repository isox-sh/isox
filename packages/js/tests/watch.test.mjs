import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { once } from 'node:events'
import { mkdir, readFile, rm, symlink } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { setTimeout as delay } from 'node:timers/promises'

import { test } from 'vitest'

import { fixture, tsc } from './fixture.mjs'

async function next(iterator) {
  let timeout

  try {
    return await Promise.race([iterator.next(), new Promise((_, reject) => {
      timeout = setTimeout(() => reject(new Error('Timed out waiting for a watch build')), 10_000)
    })])
  } finally {
    clearTimeout(timeout)
  }
}

test('watch recovers from compiler errors and updates assets, metadata, deletions, and extended config', async t => {
  const { projectRoot, config, write, read, context } = await fixture(t)

  await write('base.json', config)
  await write('tsconfig.json', { extends: './base.json' })
  await write('src/deleted.ts', 'export const unused = true')
  await write('assets/file.txt', 'first')
  await write('package.json', {
    name: '@fixture/watch',
    version: '1.0.0',
    main: './dist/index.js'
  })
  const controller = new AbortController()
  const stream = await tsc({
    watch: true,
    pollInterval: 100,
    generatePackageJson: true,
    assets: [
      {
        input: 'packages/demo package/assets',
        glob: '**/*',
        output: 'assets'
      },
    ]
  }, {
    ...context,
    signal: controller.signal
  })
  const iterator = stream[Symbol.asyncIterator]()

  t.onTestFinished(async () => {
    controller.abort(); await iterator.return()
  })
  assert.deepEqual((await next(iterator)).value, {
    success: true,
    continuous: true
  })
  const original = await read('dist/index.js')

  await write('src/index.ts', 'export const answer: number = "broken"')
  assert.deepEqual((await next(iterator)).value, {
    success: false,
    continuous: true
  })
  assert.equal(await read('dist/index.js'), original)
  await write('src/index.ts', 'export const answer: number = 43')
  await write('assets/file.txt', 'updated')
  await write('package.json', {
    name: '@fixture/watch',
    version: '2.0.0',
    main: './dist/index.js'
  })
  assert.equal((await next(iterator)).value.success, true)
  assert.match(await read('dist/index.js'), /43/)
  assert.equal(await read('dist/assets/file.txt'), 'updated')
  assert.equal(JSON.parse(await read('dist/package.json')).version, '2.0.0')
  await rm(join(projectRoot, 'src/deleted.ts'))
  await rm(join(projectRoot, 'assets/file.txt'))
  assert.equal((await next(iterator)).value.success, true)
  await assert.rejects(read('dist/deleted.js'), { code: 'ENOENT' })
  await assert.rejects(read('dist/assets/file.txt'), { code: 'ENOENT' })
  config.compilerOptions.declarationDir = 'declarations'
  await write('base.json', config)
  assert.equal((await next(iterator)).value.success, true)
  assert.match(await read('declarations/index.d.ts'), /answer/)
  // Cancelling while next() is pending must release the polling timer and iterator.
  const pending = iterator.next()

  controller.abort()
  assert.equal((await pending).done, true)
})

test('iterator return cancels a pending poll without requiring an external signal', async t => {
  const { context } = await fixture(t)
  const stream = await tsc({
    watch: true,
    pollInterval: 100
  }, context)
  const iterator = stream[Symbol.asyncIterator]()

  t.onTestFinished(() => iterator.return())
  assert.equal((await next(iterator)).value.success, true)
  const pending = iterator.next()

  await iterator.return()
  assert.equal((await pending).done, true)
})

for (const signal of ['SIGINT', 'SIGTERM']) {
  test.skipIf(process.platform === 'win32')(`CLI watch handles ${signal} without orphaning its compiler or reporting final completion`, async t => {
    const { root, projectRoot, write } = await fixture(t)

    await write('../../isox.json', {})
    await write('project.json', {
      name: 'demo',
      targets: {
        build: {
          executor: 'js:tsc',
          options: {
            watch: true,
            pollInterval: 100
          }
        }
      }
    })
    const link = join(root, 'node_modules/@isox-sh/js')

    await mkdir(join(root, 'node_modules/@isox-sh'), { recursive: true })
    await symlink(resolve(import.meta.dirname, '../../../dist/js'), link, process.platform === 'win32' ? 'junction' : 'dir')
    // Hold the actual native compilation in its own watch loop. This exercises
    // cancellation while the executor is awaiting a child, before its first result.
    const preload = join(root, 'hold-compiler.cjs')

    await write(preload, `
      const childProcess = require('node:child_process')
      const spawn = childProcess.spawn
      childProcess.spawn = function (command, args, options) {
        const compiling = args.includes('--listEmittedFiles')
        const child = spawn(command, compiling ? [...args, '--watch'] : args, options)
        if (compiling) require('node:fs').writeFileSync(${JSON.stringify(join(root, 'compiler.pid'))}, String(child.pid))
        return child
      }
    `)
    const child = spawn(process.execPath, [resolve(import.meta.dirname, '../../../dist/cli/index.js'), 'build', 'demo'], {
      cwd: projectRoot,
      stdio: ['ignore', 'pipe', 'pipe'],
      env: {
        ...process.env,
        NODE_OPTIONS: `--require=${JSON.stringify(preload)}`
      },
    })
    let stdout = ''
    let stderr = ''

    child.stdout.on('data', chunk => {
      stdout += chunk
    })
    child.stderr.on('data', chunk => {
      stderr += chunk
    })
    t.onTestFinished(async () => {
      try {
        const pid = Number(await readFile(join(root, 'compiler.pid'), 'utf8'))

        process.kill(-pid, 'SIGKILL')
      } catch (error) {
        if (!['ENOENT', 'ESRCH'].includes(error.code)) {
          throw error
        }
      }

      if (child.exitCode === null) {
        child.kill('SIGKILL')
      }
    })
    const deadline = Date.now() + 10_000

    while (!stdout.includes('compilation in watch mode') && Date.now() < deadline && child.exitCode === null) {
      await delay(25)
    }

    assert.match(stdout, /compilation in watch mode/, stderr)
    const compilerPid = Number(await readFile(join(root, 'compiler.pid'), 'utf8'))

    assert.ok(compilerPid)
    process.kill(compilerPid, 0)
    const exited = once(child, 'exit')

    child.kill(signal)
    const [code] = await Promise.race([exited, delay(5_000).then(() => {
      throw new Error('Watch process did not stop')
    })])

    assert.equal(code, signal === 'SIGINT' ? 130 : 143)
    assert.doesNotMatch(stdout, /Successfully completed/)
    assert.throws(() => process.kill(compilerPid, 0), { code: 'ESRCH' })
  })
}

test('cancels an active native compiler process and rejects process launch failures', async t => {
  const { projectRoot, context } = await fixture(t)
  const { createRequire } = await import('node:module')
  const require = createRequire(import.meta.url)
  const { invokeCompiler } = require('../../../dist/js/executors/tsc/compiler')
  const controller = new AbortController()
  const running = invokeCompiler(['--project', join(projectRoot, 'tsconfig.json'), '--watch', '--pretty', 'false'], context.workspaceRoot, controller.signal)

  t.onTestFinished(() => controller.abort())
  let finished = false

  running.then(() => {
    finished = true
  })
  await delay(150)
  assert.equal(finished, false)
  controller.abort()
  const result = await running

  assert.equal(result.success, false)
  await assert.rejects(invokeCompiler(['--version'], join(projectRoot, 'missing')), { code: 'ENOENT' })
})

test('watch snapshots ignore unrelated project sources but track extended configs and local inputs', async t => {
  const { root, projectRoot, config, write, context } = await fixture(t)
  const { createRequire } = await import('node:module')
  const { snapshot } = createRequire(import.meta.url)('../../../dist/js/executors/tsc/watch')

  await write('base.json', config)
  await write('tsconfig.json', { extends: './base.json' })
  const signal = new AbortController().signal
  const state = {}
  const current = () => snapshot(join(projectRoot, 'tsconfig.json'), {}, context, signal, state)
  const initial = await current()

  await write(join(root, 'unrelated/src/large.ts'), 'export const unrelated = 1')
  assert.equal(await current(), initial)
  await write('src/new.ts', 'export const added = 1')
  const added = await current()

  assert.notEqual(added, initial)
  await write('base.json', {
    ...config,
    compilerOptions: {
      ...config.compilerOptions,
      strict: true
    }
  })
  assert.notEqual(await current(), added)
})

test('watch follows transitive imports outside projectRoot and discovers new imports', async t => {
  const { root, config, write, context } = await fixture(t)
  const shared = join(root, 'shared')

  config.compilerOptions.noEmit = true
  config.compilerOptions.rootDir = '../..'
  delete config.include
  config.files = ['src/index.ts']
  await write('tsconfig.json', config)
  await write('src/index.ts', "import { value } from '../../../shared/first.js'; export const answer: number = value")
  await write(join(shared, 'first.ts'), "export { value } from './second.js'")
  await write(join(shared, 'second.ts'), 'export const value = 1')
  const controller = new AbortController()
  const stream = await tsc({
    watch: true,
    pollInterval: 100
  }, {
    ...context,
    signal: controller.signal
  })
  const iterator = stream[Symbol.asyncIterator]()

  t.onTestFinished(async () => {
    controller.abort()
    await iterator.return()
  })
  assert.equal((await next(iterator)).value.success, true)
  await write(join(shared, 'second.ts'), 'export const value = "wrong type"')
  assert.equal((await next(iterator)).value.success, false)
  await write(join(shared, 'second.ts'), "export { value } from './new/third.js'")
  assert.equal((await next(iterator)).value.success, false)
  await write(join(shared, 'new/third.ts'), 'export const value = 3')
  assert.equal((await next(iterator)).value.success, true)
  await write(join(shared, 'new/third.ts'), 'export const value = "wrong again"')
  assert.equal((await next(iterator)).value.success, false)
})
