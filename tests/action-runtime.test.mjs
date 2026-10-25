import assert from 'node:assert/strict'
import { execFileSync, spawn } from 'node:child_process'
import { EventEmitter } from 'node:events'

import { afterEach, test, vi } from 'vitest'

import { runCli } from '../actions/shared/runtime.mjs'

vi.mock('node:child_process', () => ({
  execFileSync: vi.fn(),
  spawn: vi.fn()
}))

const platform = Object.getOwnPropertyDescriptor(process, 'platform')
const context = {
  cwd: '/workspace',
  cli: '/workspace/isox.mjs'
}

afterEach(() => {
  Object.defineProperty(process, 'platform', platform)
  vi.resetAllMocks()
})

function start(platform) {
  Object.defineProperty(process, 'platform', { value: platform })
  const child = Object.assign(new EventEmitter(), {
    pid: 1234,
    exitCode: null,
    signalCode: null,
    kill: vi.fn(),
  })

  vi.mocked(spawn).mockReturnValue(child)
  const previous = Object.fromEntries(['SIGINT', 'SIGTERM'].map(signal => [signal, process.listeners(signal)]))
  const running = runCli(context, ['run-many'])
  const handlers = Object.fromEntries(Object.entries(previous).map(([signal, listeners]) => [
    signal, process.listeners(signal).find(listener => !listeners.includes(listener)),
  ]))
  const assertCleanedUp = () => {
    for (const [signal, listeners] of Object.entries(previous)) {
      assert.deepEqual(process.listeners(signal), listeners)
    }
  }

  return {
    child,
    running,
    handlers,
    assertCleanedUp
  }
}

test.each(['SIGINT', 'SIGTERM'])('Windows %s cancellation terminates the CLI process tree', async signal => {
  const { child, running, handlers, assertCleanedUp } = start('win32')

  try {
    handlers[signal]()
    assert.deepEqual(vi.mocked(execFileSync).mock.calls, [
      ['taskkill', ['/pid', '1234', '/T', '/F'], {
        stdio: 'ignore',
        windowsHide: true
      }],
    ])
    assert.equal(child.kill.mock.calls.length, 0)
    // GitHub can escalate from interrupt to termination before the close event.
    handlers.SIGTERM()
    assert.equal(vi.mocked(execFileSync).mock.calls.length, 1)
    child.emit('close', 1, null)
    await assert.rejects(running, /Isox worker failed/)
  } finally {
    child.emit('close', 1, null)
    await running.catch(() => {})
    assertCleanedUp()
  }
})

test.each(['SIGINT', 'SIGTERM'])('POSIX %s cancellation preserves cooperative CLI cleanup', async signal => {
  const { child, running, handlers, assertCleanedUp } = start('linux')

  try {
    handlers[signal]()
    assert.deepEqual(child.kill.mock.calls, [[signal]])
    assert.equal(vi.mocked(execFileSync).mock.calls.length, 0)
    child.emit('close', signal === 'SIGINT' ? 130 : 143, null)
    await assert.rejects(running, /Isox worker failed/)
  } finally {
    child.emit('close', 1, null)
    await running.catch(() => {})
    assertCleanedUp()
  }
})

test('Windows cancellation reports process-tree cleanup failures', async () => {
  const { child, running, handlers, assertCleanedUp } = start('win32')
  const cause = new Error('taskkill failed')

  vi.mocked(execFileSync).mockImplementation(() => {
    throw cause
  })

  try {
    handlers.SIGTERM()
    assert.equal(child.kill.mock.calls.length, 1)
    child.emit('close', 1, null)
    await assert.rejects(running, {
      message: 'Failed to terminate the Isox process tree.',
      cause
    })
  } finally {
    child.emit('close', 1, null)
    await running.catch(() => {})
    assertCleanedUp()
  }
})

test.each(['exited', 'not spawned'])('Windows cancellation ignores a CLI that has %s', async state => {
  const { child, running, handlers, assertCleanedUp } = start('win32')

  try {
    if (state === 'exited') {
      child.exitCode = 0
    } else {
      child.pid = undefined
    }

    handlers.SIGINT()
    assert.equal(vi.mocked(execFileSync).mock.calls.length, 0)
    assert.equal(child.kill.mock.calls.length, 0)
    child.emit('close', 0, null)
    await running
  } finally {
    child.emit('close', 0, null)
    await running.catch(() => {})
    assertCleanedUp()
  }
})
