import { createRequire } from 'node:module'

import { test } from 'vitest'

const require = createRequire(import.meta.url)
const assert = require('node:assert/strict')
const { resolveCommandOptions } = require('../../../dist/core/executor/configuration')

test('configurations override base options without deep merging or mutating the definition', () => {
  const command = {
    executor: 'plugin:build',
    options: { keep: 42, enabled: true, nested: { base: true }, list: ['base'], value: 'base' },
    configurations: { production: { enabled: false, nested: { prod: true }, list: [], value: null } },
  }
  const before = structuredClone(command)
  const resolved = resolveCommandOptions(command, 'demo', 'build', 'production')
  assert.deepEqual(resolved, {
    configurationName: 'production',
    options: { keep: 42, enabled: false, nested: { prod: true }, list: [], value: null },
  })
  assert.deepEqual(command, before)
  assert.deepEqual(resolveCommandOptions(command, 'demo', 'build').options, before.options)
  assert.notEqual(resolved.options, command.options)
})

test('explicit configuration overrides the default and a command can omit base options', () => {
  const command = {
    executor: 'plugin:build',
    defaultConfiguration: 'development',
    configurations: { development: { debug: true }, production: { debug: false }, empty: {} },
  }
  assert.deepEqual(resolveCommandOptions(command, 'demo', 'build'), {
    configurationName: 'development', options: { debug: true },
  })
  assert.deepEqual(resolveCommandOptions(command, 'demo', 'build', 'production'), {
    configurationName: 'production', options: { debug: false },
  })
  assert.deepEqual(resolveCommandOptions(command, 'demo', 'build', 'empty').options, {})
  assert.deepEqual(resolveCommandOptions({ executor: 'plugin:build' }, 'demo', 'build').options, {})
})

test('missing, malformed, and inherited configurations fail before execution', () => {
  for (const name of ['production', 'toString', '__proto__']) {
    assert.throws(() => resolveCommandOptions({ executor: 'plugin:build' }, 'demo', 'build', name),
      new RegExp(`Configuration ${name} not found for demo:build`))
  }
  for (const name of ['', 'two words', 'a:b', 'a,b']) {
    assert.throws(() => resolveCommandOptions({ executor: 'plugin:build' }, 'demo', 'build', name), /Invalid configuration name/)
  }
  assert.throws(() => resolveCommandOptions({ executor: 'plugin:build', defaultConfiguration: 'missing' }, 'demo', 'build'),
    /Configuration missing not found for demo:build/)
  for (const value of [null, [], 42]) {
    assert.throws(() => resolveCommandOptions({ executor: 'plugin:build', configurations: { production: value } },
      'demo', 'build', 'production'), /must be an object/)
  }
})
