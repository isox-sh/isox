import assert from 'node:assert/strict'

import { json } from '@isox-sh/core'
import { test } from 'vitest'

test('json formats objects and preserves strings and primitive values', () => {
  assert.equal(json({
    enabled: true,
    text: 'line\nbreak'
  }), '{\n  "enabled": true,\n  "text": "line\\nbreak"\n}\n')
  for (const value of [null, false, 0, '', 'hello', [1, 'two']]) {
    assert.deepEqual(JSON.parse(json(value)), value)
    assert.ok(json(value).endsWith('\n'))
  }
})

test('json rejects values that cannot produce a JSON document', () => {
  const circular = {}

  circular.self = circular
  for (const value of [undefined, () => {}, Symbol('value'), 1n, circular, { toJSON: () => undefined }]) {
    assert.throws(() => json(value), TypeError)
  }
})
