import assert from 'node:assert/strict'
import { readdir, rm } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { join } from 'node:path'

import { test } from 'vitest'

import { fixture, tsc } from './fixture.mjs'

const require = createRequire(import.meta.url)
const ts = require('typescript')

async function linkedProjects(t) {
  const result = await fixture(t)
  const { root, config, write, context } = result
  const paths = {
    '@fixture/lib': ['./packages/lib/src/index.ts'],
    '@fixture/lib/*': ['./packages/lib/src/*'],
    '#local/*': ['./packages/demo package/src/*'],
  }
  await write(join(root, 'tsconfig.base.json'), `{
    // Source aliases are shared with editors and workspace discovery.
    "compilerOptions": { "paths": ${JSON.stringify(paths)} }
  }`)
  config.extends = '../../tsconfig.base.json'
  await write('tsconfig.json', config)
  await write('src/local.ts', 'export const local = 1')
  await write('src/index.ts', `
    import { answer } from '@fixture/lib'
    import { feature } from '@fixture/lib/feature'
    import { local } from '#local/local'
    export const result = answer + feature + local
    export const literal = answer
  `)
  const lib = { name: 'lib', root: 'packages/lib' }
  context.workspace.projects.lib = lib
  context.workspace.projects.demo.dependencies = ['lib']
  await write(join(root, 'packages/lib/tsconfig.json'), {
    compilerOptions: {
      ...config.compilerOptions,
      outDir: '../../dist/lib',
      declarationDir: '../../dist/types/lib',
    },
    include: ['src/**/*'],
  })
  await write(join(root, 'packages/lib/src/index.ts'), 'export const answer = 42')
  await write(join(root, 'packages/lib/src/feature.ts'), 'export const feature = 2')
  const dependencyContext = { ...context, projectName: 'lib', projectRoot: join(root, lib.root) }
  assert.deepEqual(await tsc({}, dependencyContext), { success: true })
  return { ...result, paths, dependencyContext }
}

test('builds against dependency declarations while preserving inherited source and local aliases', async t => {
  const { root, projectRoot, write, read, context } = await linkedProjects(t)
  const original = await read('tsconfig.json')
  const base = await read(join(root, 'tsconfig.base.json'))
  // A build must use the dependency's built API, without compiling its sources again.
  await write(join(root, 'packages/lib/src/index.ts'), 'export const answer: number = "invalid source"')
  assert.deepEqual(await tsc({}, context), { success: true })
  assert.match(await read('dist/index.d.ts'), /literal = 42/)
  assert.deepEqual((await readdir(join(projectRoot, 'dist'))).sort(), ['index.d.ts', 'index.js', 'local.d.ts', 'local.js'])
  assert.equal(await read('tsconfig.json'), original)
  assert.equal(await read(join(root, 'tsconfig.base.json')), base)
  assert.equal((await readdir(join(root, '.isox/tsc'))).some(file => file.startsWith('config-')), false)

  const parsed = ts.getParsedCommandLineOfConfigFile(join(projectRoot, 'tsconfig.json'), {}, ts.sys)
  const resolved = ts.resolveModuleName('@fixture/lib', join(projectRoot, 'src/index.ts'), parsed.options, ts.sys)
  assert.equal(resolved.resolvedModule.resolvedFileName, join(root, 'packages/lib/src/index.ts'))
})

test('preserves project path overrides, configDir output paths, implicit inputs, local types and composite rootDir', async t => {
  const { root, config, paths, write, read, context } = await linkedProjects(t)
  delete config.include
  delete config.compilerOptions.rootDir
  config.compilerOptions.composite = true
  config.compilerOptions.outDir = '${configDir}/dist'
  config.compilerOptions.declarationDir = '${configDir}/types'
  config.compilerOptions.types = ['fixture']
  config.compilerOptions.paths = Object.fromEntries(Object.entries(paths).map(([name, targets]) => [name, targets.map(target => `../../${target}`)]))
  await write('tsconfig.json', config)
  await write('node_modules/@types/fixture/index.d.ts', 'declare const ambientMarker: number')
  await write('src/index.ts', `import { answer } from '@fixture/lib'
    export const result = answer + ambientMarker`)
  // Select the declaration directory from the dependency's default build configuration.
  context.workspace.projects.lib.executors = {
    build: {
      executor: 'js:tsc', defaultConfiguration: 'acc',
      configurations: { acc: { tsConfig: 'packages/lib/tsconfig.acc.json' } },
    },
  }
  await write(join(root, 'packages/lib/tsconfig.acc.json'), {
    extends: './tsconfig.json', compilerOptions: { declarationDir: '../../dist/acc-types/lib' },
  })
  await write(join(root, 'dist/acc-types/lib/index.d.ts'), 'export declare const answer = 42')
  await rm(join(root, 'dist/types/lib'), { recursive: true })
  assert.deepEqual(await tsc({}, context), { success: true })
  assert.match(await read('types/src/index.d.ts'), /result: number/)
  assert.match(await read('dist/src/index.js'), /ambientMarker/)
})

test('uses TypeScript 7 default rootDir for dependencies and the relocated consumer config', async t => {
  const { root, config, write, read, context, dependencyContext } = await linkedProjects(t)
  const libConfigPath = join(root, 'packages/lib/tsconfig.json')
  const libConfig = JSON.parse(await read(libConfigPath))
  delete libConfig.compilerOptions.rootDir
  libConfig.include.push('root.ts')
  await write(libConfigPath, libConfig)
  await write(join(root, 'packages/lib/root.ts'), 'export const root = true')
  assert.deepEqual(await tsc({}, dependencyContext), { success: true })
  assert.match(await read(join(root, 'dist/types/lib/src/index.d.ts')), /answer = 42/)

  delete config.compilerOptions.rootDir
  config.include.push('root.ts')
  await write('root.ts', 'export const root = true')
  await write('tsconfig.json', config)
  assert.deepEqual(await tsc({}, context), { success: true })
  assert.match(await read('dist/src/index.d.ts'), /literal = 42/)
})

test('missing dependency outputs fail without emitting dependency sources and clean up temporary configs', async t => {
  const { root, projectRoot, context } = await linkedProjects(t)
  await rm(join(root, 'dist/types/lib'), { recursive: true })
  assert.deepEqual(await tsc({}, context), { success: false })
  await assert.rejects(readdir(join(projectRoot, 'dist')), { code: 'ENOENT' })
  const state = await readdir(join(root, '.isox/tsc'))
  assert.equal(state.some(file => file.startsWith('config-') || file.endsWith('.lock') || file.endsWith('.claim')), false)
})

test('watch rebuilds when a dependency publishes new declarations without a source edit', async t => {
  const { root, write, read, context } = await linkedProjects(t)
  const controller = new AbortController()
  const stream = await tsc({ watch: true, pollInterval: 100 }, { ...context, signal: controller.signal })
  const iterator = stream[Symbol.asyncIterator]()
  t.onTestFinished(async () => {
    controller.abort()
    await iterator.return()
  })
  assert.equal((await iterator.next()).value.success, true)
  assert.match(await read('dist/index.d.ts'), /literal = 42/)
  await write(join(root, 'dist/types/lib/index.d.ts'), 'export declare const answer = 43')
  assert.equal((await iterator.next()).value.success, true)
  assert.match(await read('dist/index.d.ts'), /literal = 43/)
})
