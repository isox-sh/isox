import assert from 'node:assert/strict'
import { mkdir, readFile, realpath, rm, symlink } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { join } from 'node:path'

import { test } from 'vitest'

import { fixture, tsc } from './fixture.mjs'

const require = createRequire(import.meta.url)
const { linkDependency, recordSeedOwnership } = require('../../../scripts/bootstrap-files.cjs')

test('bootstrap refreshes outdated and broken dependency links without replacing directories', async t => {
  const { root } = await fixture(t)
  const old = join(root, 'versions/old')
  const current = join(root, 'versions/current')
  const link = join(root, 'dist/node_modules/dependency')
  await mkdir(old, { recursive: true })
  await mkdir(current, { recursive: true })
  linkDependency(link, old)
  linkDependency(link, current)
  assert.equal(await realpath(link), await realpath(current))
  await rm(link)
  await symlink(join(root, 'missing'), link, 'junction')
  linkDependency(link, current)
  assert.equal(await realpath(link), await realpath(current))
  await rm(link)
  await mkdir(link)
  assert.throws(() => linkDependency(link, current), /Expected a dependency symlink/)
})

test('bootstrap keeps output ownership so deleted sources are cleaned on the next build', async t => {
  const { root, projectRoot, config, write, context } = await fixture(t)
  config.compilerOptions.outDir = '../../dist/demo package'
  await write('tsconfig.json', config)
  await write('src/removed.ts', 'export const removed = true')
  await tsc({}, context)
  const output = join(root, 'dist/demo package')
  const manifest = join(output, 'package.json')
  await write(manifest, { name: 'demo', version: '0.0.1' })
  await recordSeedOwnership(root, new Map([['demo package', [manifest]]]))
  await rm(join(projectRoot, 'src/removed.ts'))
  await tsc({}, context)
  await assert.rejects(readFile(join(output, 'removed.js')), { code: 'ENOENT' })
  await assert.rejects(readFile(join(output, 'removed.d.ts')), { code: 'ENOENT' })
  assert.match(await readFile(join(output, 'index.js'), 'utf8'), /answer/)
})
