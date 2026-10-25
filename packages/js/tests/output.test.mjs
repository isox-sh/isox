import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { chmod, mkdir, readFile, rm, stat, symlink, writeFile } from 'node:fs/promises'
import { join } from 'node:path'

import { test } from 'vitest'

import { fixture, tsc } from './fixture.mjs'

test('uses extended config paths, separate declarations, and prevents emit on errors', async t => {
  const { projectRoot, config, write, read, context } = await fixture(t)

  config.compilerOptions.declarationDir = './types'
  config.compilerOptions.noEmitOnError = false
  config.compilerOptions.incremental = true
  await write('base.json', config)
  await write('tsconfig.json', { extends: './base.json' })
  assert.deepEqual(await tsc({}, context), { success: true })
  assert.match(await read('types/index.d.ts'), /answer: number/)
  const previous = await read('dist/index.js')

  await write('src/index.ts', 'export const answer: number = "invalid"')
  assert.deepEqual(await tsc({}, context), { success: false })
  assert.equal(await read('dist/index.js'), previous)
  await assert.rejects(readFile(join(projectRoot, 'tsconfig.tsbuildinfo')), { code: 'ENOENT' })
})

test('removes stale compiler output and assets while preserving unrelated and modified files', async t => {
  const { projectRoot, write, read, context } = await fixture(t)

  await write('src/unused.ts', 'export const old = 1')
  await write('assets/nested/a.txt', 'asset')
  await write('assets/skip.txt', 'excluded')
  const options = {
    assets: [{
      input: 'packages/demo package/assets',
      glob: '**/*.txt',
      output: 'static',
      ignore: ['skip.txt']
    }]
  }

  await tsc(options, context)
  assert.equal(await read('dist/static/nested/a.txt'), 'asset')
  await assert.rejects(read('dist/static/skip.txt'), { code: 'ENOENT' })
  await write('dist/keep.txt', 'unrelated')
  await write('dist/unused.d.ts', 'modified by user')
  await rm(join(projectRoot, 'src/unused.ts'))
  await rm(join(projectRoot, 'assets/nested/a.txt'))
  await tsc(options, context)
  await assert.rejects(read('dist/unused.js'), { code: 'ENOENT' })
  await assert.rejects(read('dist/static/nested/a.txt'), { code: 'ENOENT' })
  assert.equal(await read('dist/keep.txt'), 'unrelated')
  assert.equal(await read('dist/unused.d.ts'), 'modified by user')
})

test('clean:false retains stale tracked files until cleanup is enabled', async t => {
  const { projectRoot, write, read, context } = await fixture(t)

  await write('src/old.ts', 'export const old = 1')
  await tsc({}, context)
  await rm(join(projectRoot, 'src/old.ts'))
  await tsc({ clean: false }, context)
  assert.match(await read('dist/old.js'), /old/)
  await tsc({}, context)
  await assert.rejects(read('dist/old.js'), { code: 'ENOENT' })
})

test('rejects unsafe output roots, output symlinks, and overlapping ownership', async t => {
  const { root, projectRoot, config, write, read, context } = await fixture(t)

  await tsc({}, context)
  for (const outDir of ['.', '../..', './src', '../../../outside']) {
    await write('tsconfig.json', {
      ...config,
      compilerOptions: {
        ...config.compilerOptions,
        outDir
      },
      exclude: []
    })
    await assert.rejects(tsc({}, context), /Unsafe output/)
  }

  await write('tsconfig.json', config)
  await write('dist/target.txt', 'keep')
  await symlink(join(projectRoot, 'src/index.ts'), join(projectRoot, 'dist/link.js'), process.platform === 'win32' ? 'file' : undefined)
  await assert.rejects(tsc({}, context), /Unsafe output|Symlink/)
  assert.match(await read('src/index.ts'), /answer/)
  await rm(join(projectRoot, 'dist/link.js'))
  const other = join(root, 'other')

  await mkdir(join(other, 'src'), { recursive: true })
  await writeFile(join(other, 'src/other.ts'), 'export const other = 1')
  await writeFile(join(other, 'tsconfig.json'), JSON.stringify({
    ...config,
    compilerOptions: {
      ...config.compilerOptions,
      outDir: await import('node:fs/promises').then(fs => fs.realpath(join(projectRoot, 'dist')))
    }
  }))
  await assert.rejects(tsc({}, {
    ...context,
    projectRoot: other
  }), /overlaps/)
  assert.equal(await read('dist/target.txt'), 'keep')
})

test('rejects asset traversal, symlinks, compiler collisions, and unsupported Nx options', async t => {
  const { projectRoot, write, context } = await fixture(t)

  await write('assets/index.js', 'would overwrite compiler output')
  await assert.rejects(tsc({
    assets: [{
      input: 'packages/demo package/assets',
      glob: '**/*'
    }]
  }, context), /collides with compiler/)
  await assert.rejects(tsc({
    assets: [{
      input: 'packages/demo package/assets',
      glob: '**/*',
      output: '../src'
    }]
  }, context), /Unsafe asset output/)
  await symlink(join(projectRoot, 'src/index.ts'), join(projectRoot, 'assets/link.txt'))
  await assert.rejects(tsc({
    assets: [{
      input: 'packages/demo package/assets',
      glob: '*.txt'
    }]
  }, context), /Symlink/)
  await assert.rejects(tsc({ outputPath: 'dist' }, context), /unsupported Nx options/)
  await assert.rejects(tsc({ generateExportsField: true }, context), /require generatePackageJson/)
})

test('reserves output directories before parallel projects can emit into them', async t => {
  const { root, config, write, context } = await fixture(t)

  config.compilerOptions.outDir = '../../dist/shared'
  await write('tsconfig.json', config)
  await write('../other/tsconfig.json', config)
  await write('../other/src/index.ts', 'export const other = true')
  const otherContext = {
    ...context,
    projectName: 'other',
    projectRoot: join(root, 'packages/other')
  }
  const results = await Promise.allSettled([tsc({}, context), tsc({}, otherContext)])
  const failures = results.filter(result => result.status === 'rejected')

  assert.ok(failures.length >= 1, 'overlapping builds must not both emit successfully')
  for (const failure of failures) {
    assert.match(failure.reason.message, /overlaps/)
  }
})

test('makes shebang JavaScript executable after both builds and rebuilds', async t => {
  const { projectRoot, write, context } = await fixture(t)

  await write('src/index.ts', '#!/usr/bin/env node\nexport const answer = 42\n')
  await write('src/library.ts', 'export const library = true\n')
  const entry = join(projectRoot, 'dist/index.js')
  const link = join(projectRoot, 'linked-cli')

  assert.deepEqual(await tsc({}, context), { success: true })

  if (process.platform !== 'win32') {
    assert.equal((await stat(entry)).mode & 0o111, 0o111)
    assert.equal((await stat(join(projectRoot, 'dist/library.js'))).mode & 0o111, 0)
    await symlink(entry, link)
    assert.equal(spawnSync(link).status, 0)
    await chmod(entry, 0o644)
    assert.deepEqual(await tsc({}, context), { success: true })
    assert.equal(spawnSync(link).status, 0)
  }
})

test('compiler output remains cleanable after package generation fails', async t => {
  const { projectRoot, write, read, context } = await fixture(t)

  await write('src/temporary.ts', 'export const temporary = true')
  await write('package.json', {
    name: 'demo',
    version: 'invalid'
  })
  await assert.rejects(tsc({ generatePackageJson: true }, context), /valid version/)
  assert.match(await read('dist/temporary.js'), /temporary/)
  await rm(join(projectRoot, 'src/temporary.ts'))
  await write('package.json', {
    name: 'demo',
    version: '1.0.0'
  })
  assert.deepEqual(await tsc({ generatePackageJson: true }, context), { success: true })
  await assert.rejects(read('dist/temporary.js'), { code: 'ENOENT' })
  await assert.rejects(read('dist/temporary.d.ts'), { code: 'ENOENT' })
})

test('noEmit projects do not claim shared output directories', async t => {
  const { root, config, write, context } = await fixture(t)

  config.compilerOptions.outDir = '../../dist/shared'
  await write('tsconfig.json', config)
  await tsc({}, context)
  await write('../other/src/index.ts', 'export const other = true')
  await write('../other/tsconfig.json', {
    ...config,
    compilerOptions: {
      ...config.compilerOptions,
      noEmit: true
    }
  })
  assert.deepEqual(await tsc({}, {
    ...context,
    projectName: 'other',
    projectRoot: join(root, 'packages/other')
  }), { success: true })
})

test('asset collection excludes output directories containing glob metacharacters', async t => {
  const { config, write, read, context } = await fixture(t)

  config.compilerOptions.outDir = 'dist[demo]'
  await write('tsconfig.json', config)
  await write('asset.txt', 'asset')
  const options = {
    assets: [{
      input: 'packages/demo package',
      glob: '**/*.txt',
      output: 'assets'
    }]
  }

  await tsc(options, context)
  await tsc(options, context)
  assert.equal(await read('dist[demo]/assets/asset.txt'), 'asset')
  await assert.rejects(read('dist[demo]/assets/dist[demo]/assets/asset.txt'), { code: 'ENOENT' })
})

test('accepts output casing differences on case-insensitive filesystems', async t => {
  const { projectRoot, config, write, context } = await fixture(t)

  await mkdir(join(projectRoot, 'BuildOutput'))

  try {
    await stat(join(projectRoot, 'buildoutput'))
  } catch (error) {
    if (error.code === 'ENOENT') {
      return t.skip('case-sensitive filesystem')
    }

    throw error
  }

  config.compilerOptions.outDir = 'buildoutput'
  await write('tsconfig.json', config)
  assert.deepEqual(await tsc({}, context), { success: true })
  assert.match(await readFile(join(projectRoot, 'BuildOutput/index.js'), 'utf8'), /answer/)
})

test('rejects external output paths that symlink back into the workspace', async t => {
  const { root, config, write, context } = await fixture(t)
  const { mkdtemp } = await import('node:fs/promises')
  const { tmpdir } = await import('node:os')
  const outside = await mkdtemp(join(tmpdir(), 'isox-output-link-'))

  t.onTestFinished(() => rm(outside, {
    recursive: true,
    force: true
  }))
  await mkdir(join(root, 'output'))
  await symlink(join(root, 'output'), join(outside, 'back'), 'junction')
  config.compilerOptions.outDir = join(outside, 'back/nested')
  await write('tsconfig.json', config)
  await assert.rejects(tsc({}, context), /Unsafe output directory/)
  await assert.rejects(readFile(join(root, 'output/nested/index.js')), { code: 'ENOENT' })
})

test('failed packaging retains ownership of previous output roots until publication succeeds', async t => {
  const { root, config, write, context } = await fixture(t)

  config.compilerOptions.outDir = '../../dist/old'
  await write('tsconfig.json', config)
  await tsc({}, context)
  config.compilerOptions.outDir = '../../dist/new'
  await write('tsconfig.json', config)
  await write('package.json', {
    name: 'demo',
    version: 'invalid'
  })
  await assert.rejects(tsc({ generatePackageJson: true }, context), /valid version/)

  await write('../other/src/index.ts', 'export const other = true')
  await write('../other/tsconfig.json', {
    ...config,
    compilerOptions: {
      ...config.compilerOptions,
      outDir: '../../dist/old'
    }
  })
  const other = {
    ...context,
    projectName: 'other',
    projectRoot: join(root, 'packages/other')
  }

  await assert.rejects(tsc({}, other), /output owned by/)
  await write('package.json', {
    name: 'demo',
    version: '1.0.0'
  })
  assert.deepEqual(await tsc({ generatePackageJson: true }, context), { success: true })
  assert.deepEqual(await tsc({}, other), { success: true })
})
