import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { join } from 'node:path'

import { generatePackageJson } from '@isox-sh/js/helpers'
import { test } from 'vitest'

import { fixture, tsc } from './fixture.mjs'

const require = createRequire(import.meta.url)
const { sourceDependencies } = require('../../../dist/js/helpers/source-dependencies.js')

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
  `)
  assert.deepEqual([...found].sort(), [
    'node:module', 'module', 'runtime', '@scope/dependency/package.json',
    '@typescript/native/package.json', 'namespace-runtime',
  ].sort())
})

test('infers versions from source and root manifests while preserving optional and peer dependencies', async t => {
  const { root, projectRoot, write, read, config, context } = await fixture(t)
  const rootManifest = { version: '2.3.4', private: true, devDependencies: {
    runtime: '^1.0.0', '@scope/runtime': 'npm:actual-package@^2.0.0',
    optional: '^1.0.0', peer: '^1.0.0', unused: '^1.0.0', types: '^1.0.0',
  } }
  const sourceManifest = { name: '@fixture/demo', version: '1.0.0',
    devDependencies: { runtime: '~1.2.0' },
    optionalDependencies: { optional: '^3.0.0' }, peerDependencies: { peer: '^4.0.0' },
  }
  await write(join(root, 'package.json'), rootManifest)
  await write('package.json', sourceManifest)
  await write('tsconfig.json', { ...config, compilerOptions: {
    ...config.compilerOptions, paths: { '@internal/*': ['./src/*'] },
  } })
  await write('src/index.ts', `
    import value from 'runtime'
    export { other } from '@scope/runtime/subpath'
    import 'optional'
    import 'peer'
    import type Type from 'types'
    import { type Shape } from 'inline-type-only'
    import '@internal/local'
    import './local'
    import 'node:fs'
    import 'fs/promises'
    import '@fixture/demo/self'
    export { value }
  `)
  await write('src/local.ts', 'export const local = true')
  await write('tests/excluded.ts', "import 'not-part-of-the-build'")
  await write('dist/index.js', 'exports.value = 1')
  const output = join(projectRoot, 'dist')
  const files = await generatePackageJson({}, context, output, new Set([join(output, 'index.js')]), new Map())
  const generated = JSON.parse(files.get(join(output, 'package.json')))
  assert.deepEqual(generated.dependencies, { runtime: '~1.2.0', '@scope/runtime': 'npm:actual-package@^2.0.0' })
  assert.deepEqual(generated.optionalDependencies, { optional: '^3.0.0' })
  assert.deepEqual(generated.peerDependencies, { peer: '^4.0.0' })
  assert.equal(generated.devDependencies, undefined)
  assert.deepEqual(JSON.parse(await read('package.json')), sourceManifest)
  assert.deepEqual(JSON.parse(await read(join(root, 'package.json'))), rootManifest)
})

test('builds without a project manifest, infers runtime imports, and never includes type-only imports', async t => {
  const { root, write, read, context } = await fixture(t)
  await write(join(root, 'package.json'), { version: '2.3.4', devDependencies: { runtime: '^1.2.3' } })
  await write('src/modules.d.ts', `
    declare module 'runtime' { const value: number; export default value }
    declare module 'type-only' { export default interface Shape { value: number } }
    declare module 'inline-type' { export interface Shape { value: number } }
  `)
  await write('src/index.ts', `
    import value from 'runtime'
    import type Shape from 'type-only'
    import { type Shape as InlineShape } from 'inline-type'
    export const result: Shape & InlineShape = { value }
  `)
  assert.deepEqual(await tsc({ generatePackageJson: true }, context), { success: true })
  const generated = JSON.parse(await read('dist/package.json'))
  assert.equal(generated.name, 'demo')
  assert.equal(generated.version, '2.3.4')
  assert.deepEqual(generated.dependencies, { runtime: '^1.2.3' })
  assert.match(await read('dist/index.js'), /require\("runtime"\)/)
  await assert.rejects(read('package.json'), { code: 'ENOENT' })
  // A missing version must fail before replacing the previous generated manifest.
  const previous = await read('dist/package.json')
  await write(join(root, 'package.json'), { version: '2.3.4' })
  await assert.rejects(tsc({ generatePackageJson: true }, context), /Cannot determine a version for dependency runtime/)
  assert.equal(await read('dist/package.json'), previous)
})

test('infers workspace package versions, including projects without their own manifests', async t => {
  const { root, projectRoot, write, context } = await fixture(t)
  await write(join(root, 'package.json'), { version: '3.0.0' })
  context.workspace.projects.other = { name: '@fixture/other', root: 'packages/other' }
  await write(join(root, 'packages/other/src/index.ts'), 'export const value = true')
  await write('src/index.ts', "export { value } from '@fixture/other'")
  await write('dist/index.js', 'exports.value = true')
  const output = join(projectRoot, 'dist')
  const files = await generatePackageJson({}, context, output, new Set([join(output, 'index.js')]), new Map())
  assert.deepEqual(JSON.parse(files.get(join(output, 'package.json'))).dependencies, { '@fixture/other': '3.0.0' })
})

test('the JS package infers the native compiler alias from the workspace root', () => {
  const source = require('../package.json')
  const root = require('../../../package.json')
  const generated = require('../../../dist/js/package.json')
  assert.equal(source.dependencies['@typescript/native'], undefined)
  assert.equal(generated.dependencies['@typescript/native'], root.devDependencies['@typescript/native'])
})
