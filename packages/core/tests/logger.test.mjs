import { createRequire } from 'node:module'

import { test, vi } from 'vitest'

const require = createRequire(import.meta.url)
const assert = require('node:assert/strict')
const { PassThrough } = require('node:stream')
const { createLogger, logger, LogLevels, pauseProgress } = require('../../../dist/core')

test('logger defaults to info and tags messages without buffering repeated events', () => {
  const logs = []
  const instance = createLogger({ reporters: [{ log: entry => logs.push(entry) }] })

  instance.debug('hidden')
  for (let index = 0; index < 10; index++) {
    instance.info('Repeated task event')
  }

  assert.equal(logs.length, 10)
  assert.ok(logs.every(entry => entry.tag === 'Isox' && entry.type === 'info'))
  assert.equal(logger.level, LogLevels.info)
})

test('logger filters messages at each configured level', () => {
  for (const [level, expected] of [
    [LogLevels.debug, ['debug', 'info', 'success', 'warn', 'error']],
    [LogLevels.info, ['info', 'success', 'warn', 'error']],
    [LogLevels.warn, ['warn', 'error']],
    [LogLevels.error, ['error']],
    [LogLevels.silent, []],
  ]) {
    const logs = []
    const instance = createLogger({
      level,
      reporters: [{ log: entry => logs.push(entry) }]
    })

    for (const type of ['debug', 'info', 'success', 'warn', 'error']) {
      instance[type]('message')
    }

    assert.deepEqual(logs.map(entry => entry.type), expected)
  }
})

test('custom tags and levels stay independent from the shared logger', () => {
  const logs = []
  const instance = createLogger({
    level: LogLevels.debug,
    tag: 'custom',
    reporters: [{ log: entry => logs.push(entry) }],
  })

  instance.info('custom event')
  instance.withTag('build').debug('scoped event')
  assert.deepEqual(logs.map(entry => entry.tag), ['custom', 'custom:build'])
  assert.equal(logger.level, LogLevels.info)
  assert.equal(logger.tag, 'Isox')
})

test('reporters receive Error objects and structured arguments intact', () => {
  const logs = []
  const instance = createLogger({ reporters: [{ log: entry => logs.push(entry) }] })
  const error = new Error('Failed to build')
  const details = { project: 'demo' }

  instance.error(error, details)
  assert.equal(logs[0].type, 'error')
  assert.equal(logs[0].args[0], error)
  assert.equal(logs[0].args[1], details)
})

test('log levels can change at runtime and tagged loggers inherit the current level', () => {
  const logs = []
  const instance = createLogger({ reporters: [{ log: entry => logs.push(entry) }] })

  instance.debug('hidden')
  instance.level = LogLevels.debug
  const child = instance.withTag('build')

  child.debug('visible')
  instance.level = LogLevels.silent
  instance.error('hidden error')
  child.info('independent level')
  assert.deepEqual(logs.map(entry => [entry.type, entry.tag, entry.args[0]]), [
    ['debug', 'Isox:build', 'visible'],
    ['info', 'Isox:build', 'independent level'],
  ])
})

test('default reporter formats messages and errors using Node utilities', () => {
  let output = ''
  const stream = {
    write: chunk => {
      output += chunk
    }
  }
  const instance = createLogger({
    stdout: stream,
    stderr: stream,
    colors: false
  })

  instance.withTag('build').info('Built %s in %dms', 'core', 12)
  assert.equal(output, '[Isox:build] INFO Built core in 12ms\n')
  const circular = {}

  circular.self = circular
  instance.info(circular)
  assert.match(output, /Circular/)
  const error = new Error('build failed')

  instance.error(error)
  assert.ok(output.includes(error.stack))
})

test('plain reporter sends info to stdout and warnings and errors to stderr', () => {
  const stdout = new PassThrough()
  const stderr = new PassThrough()
  let output = ''
  let errors = ''

  stdout.on('data', chunk => {
    output += chunk
  })
  stderr.on('data', chunk => {
    errors += chunk
  })
  const instance = createLogger({
    stdout,
    stderr,
    colors: false
  })

  instance.info('task started')
  instance.success('task completed')
  instance.warn('task warning')
  instance.error(new Error('task failed'))
  assert.match(output, /Isox.*task started/)
  assert.match(output, /task completed/)
  assert.doesNotMatch(output, /task warning|task failed/)
  assert.match(errors, /task warning/)
  assert.match(errors, /task failed/)
  assert.doesNotMatch(errors, /task started|task completed/)
  assert.equal((output + errors).includes('\u001b['), false)
})

test('colored reporter highlights levels and scoped tags while preserving message formatting', () => {
  let output = ''
  const stream = {
    write: chunk => {
      output += chunk
    }
  }
  const instance = createLogger({
    stdout: stream,
    stderr: stream,
    colors: true,
    level: LogLevels.debug,
  }).withTag('build')

  for (const [type, color] of [['debug', 35], ['info', 36], ['success', 32], ['warn', 33], ['error', 31]]) {
    output = ''
    instance[type]('Built %s in %dms', 'core', 12)
    assert.equal(output, `\u001b[90m[Isox:build]\u001b[39m \u001b[${color}m${type.toUpperCase()}\u001b[39m Built core in 12ms\n`)
  }

  output = ''
  createLogger({
    stdout: stream,
    colors: true,
    tag: ''
  }).info('hello')
  assert.equal(output, '\u001b[36mINFO\u001b[39m hello\n')
})

test('automatic colors follow each stream and environment overrides', () => {
  const keys = ['FORCE_COLOR', 'NO_COLOR', 'TERM']
  const original = keys.map(key => process.env[key])

  try {
    for (const key of keys) {
      delete process.env[key]
    }

    let output = ''
    let errors = ''
    const stdout = {
      isTTY: true,
      write: chunk => {
        output += chunk
      }
    }
    const stderr = {
      write: chunk => {
        errors += chunk
      }
    }
    const instance = createLogger({
      stdout,
      stderr
    })

    instance.info('terminal')
    instance.error('redirected')
    assert.ok(output.includes('\u001b['))
    assert.equal(errors, '[Isox] ERROR redirected\n')

    for (const [env, colors, expected] of [
      [{ NO_COLOR: '1' }, undefined, false],
      [{ TERM: 'dumb' }, undefined, false],
      [{ FORCE_COLOR: '0' }, undefined, false],
      [{
        FORCE_COLOR: '1',
        NO_COLOR: '1'
      }, undefined, true],
      [{ FORCE_COLOR: '' }, undefined, true],
      [{ NO_COLOR: '1' }, true, true],
      [{ FORCE_COLOR: '1' }, false, false],
    ]) {
      for (const key of keys) {
        delete process.env[key]
      }

      Object.assign(process.env, env)
      output = ''
      errors = ''
      const configured = createLogger({
        stdout,
        stderr,
        colors
      }).withTag('build')

      configured.info('terminal')
      configured.error('redirected')
      assert.equal(output.includes('\u001b['), expected)
      assert.equal(errors.includes('\u001b['), expected)
    }
  } finally {
    keys.forEach((key, index) => {
      if (original[index] === undefined) {
        delete process.env[key]
      } else {
        process.env[key] = original[index]
      }
    })
  }
})

test('terminal progress animates, preserves intervening logs, and stops without leaving a timer', () => {
  vi.useFakeTimers()
  vi.stubEnv('TERM', 'xterm')
  vi.stubEnv('CI', '')
  vi.stubEnv('ISOX_PROGRESS', '')
  let output = ''
  const stream = {
    isTTY: true,
    write: chunk => {
      output += chunk
    }
  }

  try {
    const instance = createLogger({
      stdout: stream,
      stderr: stream,
      colors: false
    }).withTag('discovery')
    const stop = instance.progress('Rebuilding workspace')

    assert.match(output, /\[Isox:discovery\] ⠋ Rebuilding workspace/)
    vi.advanceTimersByTime(80)
    assert.match(output, /⠙ Rebuilding workspace/)
    instance.warn('A diagnostic')
    assert.ok(output.includes('WARN A diagnostic\n[Isox:discovery]'))
    stop()
    const completed = output

    stop()
    vi.advanceTimersByTime(160)
    assert.equal(output, completed)
    assert.equal(vi.getTimerCount(), 0)
    assert.ok(output.endsWith('\r\u001b[2K'))
  } finally {
    vi.useRealTimers()
    vi.unstubAllEnvs()
  }
})

test('progress uses plain lines for redirected output, CI, and dumb terminals', () => {
  try {
    for (const [isTTY, ci, term] of [[false, '', 'xterm'], [true, 'true', 'xterm'], [true, '', 'dumb']]) {
      vi.stubEnv('CI', ci)
      vi.stubEnv('TERM', term)
      let output = ''
      const instance = createLogger({
        colors: false,
        stdout: {
          isTTY,
          write: chunk => {
            output += chunk
          }
        }
      })
      const stop = instance.progress('Rebuilding workspace')

      stop()
      assert.equal(output, '[Isox] INFO Rebuilding workspace\n')
    }
  } finally {
    vi.unstubAllEnvs()
  }
})

test('progress respects custom reporters, level filtering, and idempotent cleanup', () => {
  const entries = []
  let stops = 0
  const reporter = {
    log: entry => entries.push(entry),
    progress: entry => {
      entries.push(entry)

      return () => {
        stops++
      }
    }
  }
  const instance = createLogger({ reporters: [reporter] })
  const stop = instance.progress('Rebuilding workspace')

  stop()
  stop()
  assert.equal(stops, 1)
  assert.equal(entries.length, 1)
  instance.level = LogLevels.warn
  instance.progress('Hidden progress')()
  assert.equal(entries.length, 1)
  createLogger({ reporters: [{ log: entry => entries.push(entry) }] }).progress('Plain progress')()
  assert.equal(entries.at(-1).args[0], 'Plain progress')
})

test('nested terminal owners pause animation until both finish without erasing their output', () => {
  vi.useFakeTimers()
  vi.stubEnv('TERM', 'xterm')
  vi.stubEnv('CI', '')
  vi.stubEnv('ISOX_PROGRESS', '')
  let output = ''
  const instance = createLogger({
    colors: false,
    stdout: {
      isTTY: true,
      write: chunk => {
        output += chunk
      }
    }
  })
  const stop = instance.progress('Running a command')
  const resumeOuter = pauseProgress()
  const resumeInner = pauseProgress()

  try {
    assert.ok(output.endsWith('INFO Running a command\n'))
    const paused = output

    vi.advanceTimersByTime(160)
    instance.info('Child output')
    assert.equal(output, `${paused}[Isox] INFO Child output\n`)
    resumeOuter()
    const stillPaused = output

    vi.advanceTimersByTime(160)
    assert.equal(output, stillPaused)
    resumeInner()
    assert.match(output, /⠙ Running a command$/)
    resumeInner()
    stop()
    assert.equal(vi.getTimerCount(), 0)
  } finally {
    resumeOuter()
    resumeInner()
    stop()
    vi.useRealTimers()
    vi.unstubAllEnvs()
  }
})
