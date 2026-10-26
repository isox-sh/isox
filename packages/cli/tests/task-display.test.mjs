import assert from 'node:assert/strict'
import { stripVTControlCharacters } from 'node:util'

import { test, vi } from 'vitest'

import { createTaskDisplay } from '../../../dist/cli/shared/task-display.js'
import { runProcess } from '../../../dist/core/index.js'
import { affectedFixture, cliPath } from './helpers/affected-fixture.mjs'

function terminal(t, options = {}) {
  vi.stubEnv('CI', '')
  vi.stubEnv('TERM', 'xterm')
  vi.stubEnv('ISOX_PROGRESS', '')
  vi.useFakeTimers()
  t.onTestFinished(() => {
    vi.useRealTimers()
    vi.unstubAllEnvs()
  })
  const writes = []
  const stream = {
    isTTY: true,
    columns: 100,
    rows: 24,
    write(chunk) {
      writes.push(chunk.toString())

      return true
    }
  }
  const display = createTaskDisplay({
    stdout: stream,
    stderr: stream,
    colors: false,
    ...options
  })

  t.onTestFinished(() => display.stop())

  return {
    display,
    stream,
    writes,
    frame: () => writes.at(-1),
    output: () => stripVTControlCharacters(writes.join(''))
  }
}

test('the live footer counts pending work and animates only running tasks', t => {
  const { display, frame, output } = terminal(t, {
    target: 'build',
    total: 3
  })

  display.start('app', 'app:build:production')
  display.start('lib', 'lib:build')
  assert.match(frame(), / {3}Running target build for 3 projects/)
  assert.match(frame(), /2 running · 1 pending · 0\/3 completed/)
  assert.match(frame(), /⠋ isox run app:build:production/)
  vi.advanceTimersByTime(80)
  assert.match(frame(), /⠙ isox run lib:build/)
  display.message('app', {
    type: 'isox:task-result',
    message: 'isox run app:build:production (cache hit abc123)',
    status: 'success'
  })
  assert.doesNotMatch(output(), /\[local cache\]/)
  display.finish('app', true, false)
  assert.match(output(), /✔ isox run app:build:production \[local cache\]/)
  assert.doesNotMatch(frame(), /isox run app:build/)
  assert.match(frame(), /1 running · 1 pending · 1\/3 completed/)
  assert.match(frame(), /1 succeeded \[1 read from cache\]/)
  const completedWrites = output().match(/✔ isox run app:build:production/g).length

  vi.advanceTimersByTime(240)
  assert.equal(output().match(/✔ isox run app:build:production/g).length, completedWrites)
})

test('successful output stays quiet and failures print their diagnostics once', t => {
  const { display, output, writes } = terminal(t, {
    target: 'build',
    total: 2
  })

  display.start('lib', 'lib:build')
  display.output('lib', Buffer.from('noisy successful compiler\n'), 'stdout')
  display.finish('lib', true, false)
  assert.doesNotMatch(output(), /noisy successful/)
  display.start('app', 'app:build')
  display.output('app', Buffer.from('partial'), 'stdout')
  display.output('app', Buffer.from(' line\n'), 'stdout')
  display.output('app', Buffer.from('[Isox] ERROR Missing entry point\n'), 'stderr')
  assert.doesNotMatch(output(), /Missing entry point/)
  display.finish('app', false, false)
  assert.match(output(), /✖ isox run app:build \(failed after .*s\)\n\n {6}partial line\n {6}\[Isox\] ERROR Missing entry point/)
  vi.advanceTimersByTime(160)
  assert.equal(output().match(/Missing entry point/g).length, 1)
  display.stop()
  assert.match(output(), /1 succeeded, 1 failed, 0 cancelled, 0 not run/)
  const count = writes.length

  display.stop()
  vi.advanceTimersByTime(1000)
  assert.equal(writes.length, count)
})

test('summaries distinguish cached, cancelled, and unstarted tasks', t => {
  const { display, output } = terminal(t, {
    target: 'build',
    total: 3
  })

  display.start('lib', 'lib:build')
  display.message('lib', {
    type: 'isox:task-result',
    message: 'isox run lib:build (cache hit abc123)',
    status: 'success'
  })
  display.finish('lib', true, false)
  display.start('app', 'app:build')
  display.finish('app', false, true)
  display.stop()
  assert.match(output(), /1 succeeded, 0 failed, 1 cancelled, 1 not run/)
  assert.match(output(), /1\/3 tasks read from cache/)
})

test('narrow terminals bound the live footer without truncating completed results', t => {
  const { display, stream, frame, output } = terminal(t)

  stream.columns = 30
  stream.rows = 6
  for (let index = 0; index < 8; index++) {
    display.start(String(index), `project-${index}:build:production`)
  }

  display.message('0', {
    type: 'isox:task-result',
    status: 'success',
    message: 123
  })
  display.message('missing', null)
  assert.ok(frame().trim().split('\n').length <= 4)
  assert.ok(frame().trim().split('\n').every(line => [...stripVTControlCharacters(line)].length < stream.columns))
  display.finish('0', false, true)
  assert.match(output(), /– isox run project-0:build:production \(cancelled after/)
})

test('failure buffers preserve split UTF-8 and label truncated diagnostics', t => {
  const { display, output } = terminal(t)

  display.start('app', 'app:build')
  display.output('app', Buffer.from('x'.repeat(262145)), 'stdout')
  const message = Buffer.from('\nCannot resolve 日本語.ts\n')
  const split = message.indexOf(Buffer.from('日')) + 1

  display.output('app', message.subarray(0, split), 'stdout')
  display.output('app', message.subarray(split), 'stdout')
  display.finish('app', false, false)
  assert.match(output(), /Earlier output omitted/)
  assert.match(output(), /Cannot resolve 日本語.ts/)
  assert.doesNotMatch(output(), /�/)
})

test('resizing does not erase reflowed terminal rows', t => {
  const { display, stream, writes } = terminal(t)

  display.start('app', 'app:build')
  const previous = writes.length

  stream.columns = 20
  vi.advanceTimersByTime(80)
  assert.equal(writes.slice(previous).join('').includes('\u001b['), false)
})

test('CI and progress opt-outs stream logs and summaries without animation', t => {
  const { stream } = terminal(t)

  for (const [name, value] of [['CI', 'true'], ['TERM', 'dumb'], ['ISOX_PROGRESS', '0']]) {
    vi.stubEnv(name, value)
    const writes = []
    const plain = {
      ...stream,
      write: chunk => writes.push(chunk.toString())
    }
    const display = createTaskDisplay({
      colors: false,
      stdout: plain,
      stderr: plain,
      target: 'build',
      total: 2
    })

    assert.equal(display.interactive, false)
    display.start('app', 'app:build')
    display.output('app', Buffer.from('compiler output\n'), 'stdout')
    display.finish('app', true, false)
    display.start('lib', 'lib:build')
    display.output('lib', Buffer.from('partial compiler output'), 'stdout')
    display.finish('lib', true, false)
    display.stop()
    assert.match(writes.join(''), /compiler output\n+ {3}✔ isox run app:build/)
    assert.match(writes.join(''), /Successfully ran target build for 2 projects/)
    assert.match(writes.join(''), /partial compiler output\n {3}✔ isox run lib:build/)
    assert.equal(writes.join('').includes('\u001b['), false)
    vi.stubEnv(name, '')
  }

  const display = createTaskDisplay({
    stdout: {
      ...stream,
      isTTY: false
    },
    stderr: stream
  })

  assert.equal(display.interactive, false)
  display.stop()
})

test('live workers send task results separately from executor diagnostics', async t => {
  const { root, env } = await affectedFixture(t)
  const messages = []
  let output = ''
  const result = await runProcess(process.execPath, [cliPath, 'run', 'lib:build', '--prod'], {
    cwd: root,
    env: {
      ...env,
      ISOX_TASK_OUTPUT: 'live'
    },
    onMessage: message => messages.push(message),
    onOutput: chunk => {
      output += chunk
    }
  })

  assert.equal(result.success, true, output)
  assert.equal(messages.length, 1)
  assert.equal(messages[0].type, 'isox:task-result')
  assert.equal(messages[0].status, 'success')
  assert.match(messages[0].message, /^isox run lib:build:production \(\d+\.\d+s\)$/)
  assert.doesNotMatch(output, /✔|Successfully completed|Running @fixture/)
})

test('colors distinguish progress, success, failure diagnostics, and summaries', t => {
  const { display, writes, output } = terminal(t, {
    colors: true,
    target: 'build',
    total: 2
  })

  display.start('good', 'good:build')
  assert.ok(writes.join('').includes('\u001b[1;36m   Running'))
  assert.match(output(), /\[----------\]/)
  display.finish('good', true, false)
  assert.ok(writes.join('').includes('\u001b[32m✔'))
  assert.match(output(), /\[=====-----\]/)
  display.start('bad', 'bad:build')
  display.output('bad', Buffer.from('error TS2307: Missing module\n'), 'stdout')
  display.finish('bad', false, false)
  display.stop()
  assert.ok(writes.join('').includes('\u001b[31m✖'))
  assert.ok(writes.join('').includes('\u001b[31merror TS2307'))
  assert.match(output(), /\n {6}error TS2307: Missing module/)
  assert.match(output(), /Failed tasks:\n {6}- bad:build/)
})
