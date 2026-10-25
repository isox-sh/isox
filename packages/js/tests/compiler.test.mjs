import assert from 'node:assert/strict'
import { copyFile, mkdir, readFile, symlink } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { dirname, join } from 'node:path'
import { setTimeout as delay } from 'node:timers/promises'

import { test } from 'vitest'

import { fixture } from './fixture.mjs'

const require = createRequire(import.meta.url)

test.skipIf(process.platform === 'win32')('cancelling the compiler also kills children left behind by its launcher', async t => {
  const { root, write } = await fixture(t)
  // Load the real wrapper beside a fake native compiler that leaves a stubborn child.
  const wrapper = join(root, 'compiler.cjs')
  await copyFile(join(import.meta.dirname, '../../../dist/js/executors/tsc/compiler.js'), wrapper)
  const core = join(root, 'node_modules/@isox-sh/core')
  await mkdir(dirname(core), { recursive: true })
  await symlink(dirname(require.resolve('@isox-sh/core/package.json')), core, 'dir')
  await write(join(root, 'node_modules/@typescript/native/package.json'), { bin: { tsc: './launch.cjs' } })
  await write(join(root, 'node_modules/@typescript/native/launch.cjs'), `
    require('node:child_process').spawn(process.execPath, ['stubborn.cjs'], { stdio: 'ignore' })
    setInterval(() => {}, 100)
  `)
  await write(join(root, 'stubborn.cjs'), `
    process.on('SIGTERM', () => {})
    require('node:fs').writeFileSync('ready', String(process.pid))
    setInterval(() => {}, 100)
  `)
  const { invokeCompiler } = require(wrapper)
  const controller = new AbortController()
  let pid
  t.onTestFinished(() => {
    controller.abort()
    if (pid) {
      try {
        process.kill(pid, 'SIGKILL')
      } catch (error) {
        if (error.code !== 'ESRCH') {
          throw error
        }
      }
    }
  })
  const running = invokeCompiler([], root, controller.signal)
  const deadline = Date.now() + 5_000
  while (!pid && Date.now() < deadline) {
    try {
      pid = Number(await readFile(join(root, 'ready'), 'utf8'))
    } catch (error) {
      if (error.code !== 'ENOENT') {
        throw error
      }
    }
    if (!pid) {
      await delay(20)
    }
  }
  assert.ok(pid, 'native compiler did not start')
  controller.abort()
  assert.equal((await running).success, false)
  await delay(20)
  assert.throws(() => process.kill(pid, 0), { code: 'ESRCH' })
})
