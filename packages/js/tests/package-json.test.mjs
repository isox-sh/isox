import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { join } from 'node:path'

import { generatePackageJson } from '@isox-sh/js/helpers'
import { test } from 'vitest'

import { fixture, tsc } from './fixture.mjs'

test('generates package metadata, workspace versions, exports, and additional entry points', async t => {
  const { root, projectRoot, write, read, context } = await fixture(t)
  await write('src/feature.ts', 'export const feature = true')
  const source = {
    name: '@fixture/demo', version: '1.0.0', main: './dist/index.js', types: './dist/index.d.ts',
    license: 'MIT', files: ['dist'], scripts: { build: 'obsolete' }, devDependencies: { tooling: '*' },
    dependencies: { '@fixture/core': 'workspace:^', alias: 'workspace:@fixture/core@~', external: '^2.0.0' },
    peerDependencies: { '@fixture/core': 'workspace:*' },
  }
  await write('package.json', source)
  context.workspace.projects.core = { name: 'core', root: 'packages/core' }
  await mkdir(join(root, 'packages/core'), { recursive: true })
  await writeFile(join(root, 'packages/core/package.json'), JSON.stringify({ name: '@fixture/core', version: '1.2.3-beta.1+build' }))
  assert.deepEqual(await tsc({
    generatePackageJson: true, generateExportsField: true, additionalEntryPoints: {
      './feature': { types: './feature.d.ts', default: './feature.js' },
    }
  }, context), { success: true })
  const generated = JSON.parse(await read('dist/package.json'))
  assert.equal(generated.main, './index.js')
  assert.equal(generated.types, './index.d.ts')
  assert.deepEqual(generated.exports, {
    '.': { types: './index.d.ts', default: './index.js' },
    './feature': { types: './feature.d.ts', default: './feature.js' },
  })
  assert.deepEqual(generated.dependencies, { '@fixture/core': '^1.2.3-beta.1+build', alias: 'npm:@fixture/core@~1.2.3-beta.1+build', external: '^2.0.0' })
  assert.deepEqual(generated.peerDependencies, { '@fixture/core': '1.2.3-beta.1+build' })
  assert.equal(generated.devDependencies, undefined)
  assert.equal(generated.scripts, undefined)
  assert.deepEqual(JSON.parse(await read('package.json')), source)
  assert.equal(Object.hasOwn(generated, 'files'), false)
  assert.equal(projectRoot.endsWith('demo package'), true)
})

test('packages executor-only plugins with executor implementations and schemas, without root exports', async t => {
  const { write, read, context } = await fixture(t)
  await write('src/commands/example/example.command.ts', 'export default () => ({ success: true })')
  await write('package.json', { name: '@fixture/plugin', version: '0.1.0', executors: './executors.json' })
  await write('executors.json', { executors: { example: { implementation: './dist/commands/example/example.command', schema: './schemas/example.json' } } })
  await write('schemas/example.json', { $ref: '../support/definitions.json' })
  await write('support/definitions.json', { type: 'object' })
  await tsc({ generatePackageJson: true, generateExportsField: true }, context)
  const generated = JSON.parse(await read('dist/package.json'))
  assert.equal(Object.hasOwn(generated, 'files'), false)
  assert.equal(generated.main, undefined)
  assert.equal(generated.types, undefined)
  assert.equal(generated.exports, undefined)
  assert.equal(generated.executors, './executors.json')
  const executors = JSON.parse(await read('dist/executors.json'))
  assert.equal(executors.executors.example.implementation, './commands/example/example.command.js')
  assert.equal(executors.executors.example.schema, './schemas/example.json')
  assert.deepEqual(JSON.parse(await read('dist/support/definitions.json')), { type: 'object' })
})

test('validates package entries and preserves the last successful manifest on compilation failure', async t => {
  const { write, read, context } = await fixture(t)
  await tsc({ generatePackageJson: true }, context)
  assert.equal(JSON.parse(await read('dist/package.json')).name, 'demo')
  await write('package.json', { name: '@fixture/demo', version: '1.0.0', main: './dist/missing.js' })
  await assert.rejects(tsc({ generatePackageJson: true }, context), /does not match generated output/)
  await write('package.json', { name: '@fixture/demo', version: '1.0.0', main: './dist/index.js' })
  await tsc({ generatePackageJson: true }, context)
  const previous = await read('dist/package.json')
  await write('package.json', { name: '@fixture/demo', version: '2.0.0', main: './dist/index.js' })
  await write('src/index.ts', 'export const answer: number = "wrong"')
  assert.deepEqual(await tsc({ generatePackageJson: true }, context), { success: false })
  assert.equal(await read('dist/package.json'), previous)
})

for (const type of ['commonjs', 'module']) {
  test(`packs, installs, and resolves runtime and declarations for a generated ${type} package`, async t => {
    const { root, projectRoot, write, context } = await fixture(t)
    await write('package.json', { name: '@fixture/generated', version: '1.0.0', type })
    await tsc({ generatePackageJson: true, generateExportsField: true }, context)
    const packed = spawnSync('npm', ['pack', '--ignore-scripts', '--json', '--pack-destination', root, '--cache', join(root, '.npm-cache')], {
      cwd: join(projectRoot, 'dist'), encoding: 'utf8', timeout: 20_000,
    })
    assert.equal(packed.status, 0, packed.stderr)
    const tarball = join(root, JSON.parse(packed.stdout)[0].filename)
    const consumer = join(root, 'consumer')
    await mkdir(consumer)
    await writeFile(join(consumer, 'package.json'), JSON.stringify({ private: true, type }))
    const installed = spawnSync('npm', ['install', tarball, '--ignore-scripts', '--no-audit', '--no-fund', '--package-lock=false', '--cache', join(root, '.npm-cache')], {
      cwd: consumer, encoding: 'utf8', timeout: 20_000,
    })
    assert.equal(installed.status, 0, installed.stderr)
    const require = createRequire(join(consumer, 'consumer.cjs'))
    if (type === 'commonjs') {
      assert.equal(require('@fixture/generated').answer, 42)
    } else {
      await writeFile(join(consumer, 'consumer.mjs'), "import { answer } from '@fixture/generated'\nif (answer !== 42) throw new Error('invalid runtime export')")
      const runtime = spawnSync(process.execPath, ['consumer.mjs'], { cwd: consumer, encoding: 'utf8' })
      assert.equal(runtime.status, 0, runtime.stderr)
    }
    await writeFile(join(consumer, 'index.ts'), "import { answer } from '@fixture/generated'\nconst value: number = answer\nexport { value }")
    await writeFile(join(consumer, 'tsconfig.json'), JSON.stringify({ compilerOptions: { module: 'NodeNext', target: 'ES2022', noEmit: true, types: [] }, files: ['index.ts'] }))
    assert.deepEqual(await tsc({}, { ...context, projectRoot: consumer }), { success: true })
    assert.equal(JSON.parse(await readFile(join(consumer, 'node_modules/@fixture/generated/package.json'), 'utf8')).types, './index.d.ts')
  }, 30_000)
}

test('packages a separate declaration directory and preserves explicit conditional and wildcard exports', async t => {
  const { config, write, read, context } = await fixture(t)
  config.compilerOptions.declarationDir = 'declarations'
  config.compilerOptions.declarationMap = true
  await write('tsconfig.json', config)
  await write('src/feature.ts', 'export const feature: boolean = true')
  await write('package.json', {
    name: '@fixture/declarations', version: '1.0.0',
    main: './dist/index.js', types: './declarations/index.d.ts',
    exports: {
      '.': { types: './declarations/index.d.ts', require: './dist/index.js' },
      './*': { types: './declarations/*.d.ts', default: './dist/*.js' },
      './package.json': './package.json',
    },
  })
  await tsc({ generatePackageJson: true, generateExportsField: true }, context)
  const manifest = JSON.parse(await read('dist/package.json'))
  assert.equal(manifest.types, './types/index.d.ts')
  assert.deepEqual(manifest.exports['.'], { types: './types/index.d.ts', require: './index.js' })
  assert.deepEqual(manifest.exports['./*'], { types: './types/*.d.ts', default: './*.js' })
  assert.equal(manifest.exports['./package.json'], './package.json')
  assert.match(await read('dist/types/index.d.ts'), /answer/)
  assert.equal(JSON.parse(await read('dist/types/index.d.ts.map')).sources[0], '../../src/index.ts')
})

test('resolves relative workspace dependencies whose directory contains a scope', async t => {
  const { write, read, context } = await fixture(t)
  await write('../@fixture/core/package.json', { name: '@fixture/core', version: '2.3.4' })
  await write('package.json', {
    name: '@fixture/demo', version: '1.0.0',
    dependencies: { '@fixture/core': 'workspace:../@fixture/core', alias: 'workspace:../@fixture/core' },
  })
  assert.deepEqual(await tsc({ generatePackageJson: true }, context), { success: true })
  const manifest = JSON.parse(await read('dist/package.json'))
  assert.deepEqual(manifest.dependencies, { '@fixture/core': '2.3.4', alias: 'npm:@fixture/core@2.3.4' })
})

test('public package generator lets plugins extend metadata before writing it', async t => {
  const { projectRoot, write, read, context } = await fixture(t)
  const source = { name: '@fixture/demo', version: '1.0.0' }
  await write('package.json', source)
  assert.deepEqual(await tsc({}, context), { success: true })
  const outDir = join(projectRoot, 'dist')
  const emitted = new Set(['index.js', 'index.d.ts'].map(file => join(outDir, file)))
  const files = await generatePackageJson({ generateExportsField: true }, context, outDir, emitted, new Map())
  const packagePath = join(outDir, 'package.json')
  const manifest = JSON.parse(files.get(packagePath).toString())
  assert.equal(manifest.exports['.'].default, './index.js')
  manifest.customPlugin = { enabled: true }
  files.set(packagePath, Buffer.from(JSON.stringify(manifest)))
  await assert.rejects(read('dist/package.json'), { code: 'ENOENT' })
  await writeFile(packagePath, files.get(packagePath))
  assert.deepEqual(JSON.parse(await read('dist/package.json')).customPlugin, { enabled: true })
  assert.deepEqual(JSON.parse(await read('package.json')), source)
})

test('builds a standalone package in the workspace dist directory with colocated schema assets', async t => {
  const { root, config, write, read, context } = await fixture(t)
  config.compilerOptions.outDir = '../../dist/demo'
  await write('tsconfig.json', config)
  await write('package.json', {
    name: '@fixture/demo', version: '1.0.0', main: '../../dist/demo/index.js',
    executors: './executors.json', exports: './src/index.ts',
    publishConfig: { access: 'public', directory: '../../dist/demo', linkDirectory: true, exports: { '.': './index.js' } },
  })
  await write('executors.json', { executors: { demo: {
    implementation: '../../dist/demo/index.js', schema: '../../dist/demo/executors/demo/demo.schema.json',
  } } })
  await write('src/executors/demo/demo.schema.json', { type: 'object' })
  assert.deepEqual(await tsc({ generatePackageJson: true, assets: [{
    input: 'packages/demo package/src', glob: 'executors/**/*.schema.json',
  }] }, context), { success: true })
  const output = join(root, 'dist/demo')
  const manifest = JSON.parse(await readFile(join(output, 'package.json'), 'utf8'))
  assert.equal(manifest.main, './index.js')
  assert.deepEqual(manifest.publishConfig, { access: 'public' })
  assert.deepEqual(manifest.exports, { '.': './index.js' })
  const registry = JSON.parse(await readFile(join(output, 'executors.json'), 'utf8'))
  assert.equal(registry.executors.demo.schema, './executors/demo/demo.schema.json')
  assert.deepEqual(JSON.parse(await readFile(join(output, 'executors/demo/demo.schema.json'), 'utf8')), { type: 'object' })
  assert.equal(JSON.parse(await read('package.json')).publishConfig.directory, '../../dist/demo')
})
