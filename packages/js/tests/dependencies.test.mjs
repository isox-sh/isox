import assert from 'node:assert/strict'
import { join } from 'node:path'

import { generatePackageJson } from '@isox-sh/js/helpers'
import { test } from 'vitest'

import { fixture, tsc } from './fixture.mjs'

test('infers versions from source and root manifests while preserving optional and peer dependencies', async t => {
  const { root, projectRoot, write, read, config, context } = await fixture(t)
  const rootManifest = {
    version: '2.3.4',
    private: true,
    devDependencies: {
      runtime: '^1.0.0',
      '@scope/runtime': 'npm:actual-package@^2.0.0',
      optional: '^1.0.0',
      peer: '^1.0.0',
      unused: '^1.0.0',
      types: '^1.0.0',
    }
  }
  const sourceManifest = {
    name: '@fixture/demo',
    version: '1.0.0',
    devDependencies: { runtime: '~1.2.0' },
    optionalDependencies: { optional: '^3.0.0' },
    peerDependencies: { peer: '^4.0.0' },
  }

  await write(join(root, 'package.json'), rootManifest)
  await write('package.json', sourceManifest)
  await write('tsconfig.json', {
    ...config,
    compilerOptions: {
      ...config.compilerOptions,
      paths: { '@internal/*': ['./src/*'] },
    }
  })
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

  assert.deepEqual(generated.dependencies, {
    runtime: '~1.2.0',
    '@scope/runtime': 'npm:actual-package@^2.0.0'
  })
  assert.deepEqual(generated.optionalDependencies, { optional: '^3.0.0' })
  assert.deepEqual(generated.peerDependencies, { peer: '^4.0.0' })
  assert.equal(generated.devDependencies, undefined)
  assert.deepEqual(JSON.parse(await read('package.json')), sourceManifest)
  assert.deepEqual(JSON.parse(await read(join(root, 'package.json'))), rootManifest)
})

test('builds without a project manifest, infers runtime imports, and never includes type-only imports', async t => {
  const { root, write, read, context } = await fixture(t)

  await write(join(root, 'package.json'), {
    version: '2.3.4',
    devDependencies: { runtime: '^1.2.3' }
  })
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
  context.workspace.projects.other = {
    name: '@fixture/other',
    root: 'packages/other'
  }
  await write(join(root, 'packages/other/src/index.ts'), 'export const value = true')
  await write('src/index.ts', "export { value } from '@fixture/other'")
  await write('dist/index.js', 'exports.value = true')
  const output = join(projectRoot, 'dist')
  const files = await generatePackageJson({}, context, output, new Set([join(output, 'index.js')]), new Map())

  assert.deepEqual(JSON.parse(files.get(join(output, 'package.json'))).dependencies, { '@fixture/other': '3.0.0' })
})

test('infers a workspace dependency used only by exported types without a source dependency declaration', async t => {
  const { root, projectRoot, write, context } = await fixture(t)

  context.workspace.projects.types = {
    name: 'types',
    root: 'packages/types'
  }
  await write(join(root, 'packages/types/package.json'), {
    name: '@fixture/types',
    version: '2.0.0'
  })
  await write('src/index.ts', "export type { Shape } from '@fixture/types'")
  await write('dist/index.js', '')
  const output = join(projectRoot, 'dist')
  const files = await generatePackageJson({}, context, output, new Set([join(output, 'index.js')]), new Map())

  assert.deepEqual(JSON.parse(files.get(join(output, 'package.json'))).dependencies, { '@fixture/types': '2.0.0' })
})
