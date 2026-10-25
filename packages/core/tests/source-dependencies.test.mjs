import assert from 'node:assert/strict'
import { createRequire } from 'node:module'

import { test } from 'vitest'

const require = createRequire(import.meta.url)
const { sourceDependencies } = require('../../../dist/core')

test('detects runtime import syntax and excludes type-only imports, comments, and strings', () => {
  const found = sourceDependencies('example.ts', `
    import value from 'default-import'
    import { value } from 'named-import'
    import * as values from 'namespace-import'
    import 'side-effect'
    import { type Shape, value } from 'mixed-import'
    import Default, { type Shape } from 'default-with-types'
    import {} from 'empty-import'
    export { value } from 'named-export'
    export * from 'star-export'
    export { type Shape, value } from 'mixed-export'
    import value = require('import-equals')
    import('dynamic-import')
    require('commonjs')
    require.resolve('resolved/package.json')
    import.meta.resolve('meta-resolved')
    import type Default from 'type-default'
    import type * as Types from 'type-namespace'
    import type { Shape } from 'type-named'
    import { type Shape } from 'inline-type-import'
    import type Value = require('type-import-equals')
    export type { Shape } from 'type-export'
    export type * from 'type-star-export'
    export { type Shape } from 'inline-type-export'
    type Shape = import('import-type-expression').Shape
    // import value from 'comment'
    /* require('block-comment') */
    const text = "import value from 'string'"
    import(variable)
    require('computed-' + variable)
  `)
  assert.deepEqual([...found].sort(), [
    'default-import', 'named-import', 'namespace-import', 'side-effect', 'mixed-import',
    'default-with-types', 'empty-import', 'named-export', 'star-export', 'mixed-export',
    'import-equals', 'dynamic-import', 'commonjs', 'resolved/package.json', 'meta-resolved',
  ].sort())
})

test('detects module-local createRequire imports and aliases without counting another package’s lookups', () => {
  const found = sourceDependencies('example.ts', `
    import { createRequire as makeRequire } from 'node:module'
    import * as module from 'module'
    const local = makeRequire(import.meta.url)
    const alias = local
    alias('runtime')
    local.resolve('@scope/dependency/package.json')
    makeRequire(__filename).resolve('@typescript/native/package.json')
    module.createRequire(__filename)('namespace-runtime')
    const foreign = makeRequire(pluginPackagePath)
    foreign.resolve('foreign-dependency')
    makeRequire(pluginPackagePath).resolve('foreign-inline-dependency')
    require.resolve('workspace-plugin', { paths: [workspaceRoot] })
  `)
  assert.deepEqual([...found].sort(), [
    'node:module', 'module', 'runtime', '@scope/dependency/package.json',
    '@typescript/native/package.json', 'namespace-runtime',
  ].sort())
})

test('workspace discovery includes type-only imports and re-exports', () => {
  const source = `
    import type { Shape } from 'type-only'
    export type { Shape } from 'type-export'
    import { type Shape } from 'inline-type'
    import type Types = require('type-equals')
    type Shape = import('type-expression').Shape
  `
  assert.deepEqual([...sourceDependencies('types.ts', source)], [])
  assert.deepEqual([...sourceDependencies('types.ts', source, { includeTypes: true })].sort(), [
    'inline-type', 'type-equals', 'type-export', 'type-expression', 'type-only',
  ])
})
