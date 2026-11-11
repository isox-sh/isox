import assert from 'node:assert/strict'
import { mkdir, readFile, stat, writeFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { dirname, join, resolve } from 'node:path'

import { test } from 'vitest'

import { fixture } from './fixture.mjs'

const require = createRequire(import.meta.url)
const { default: migrate } = require('../../../dist/js/migrations/workspace-tsconfig')
const { planMigrations, runMigrations } = require('../../../dist/core')

async function workspace(t) {
  const { root, context } = await fixture(t)
  await writeFile(join(root, 'isox.json'), '{}')
  await writeFile(join(root, 'tsconfig.base.json'), '{"compilerOptions":{"strict":true}}')
  const write = async (file, config) => {
    await mkdir(dirname(join(root, file)), { recursive: true })
    await writeFile(join(root, file), JSON.stringify(config, null, 2) + '\n')
  }

  for (const name of ['plain', 'custom']) {
    await write(`packages/${name}/project.json`, {
      name,
      ...(name === 'custom' ? { $schema: './custom-schema.json' } : {}),
      targets: {
        build: {
          executor: 'js:tsc',
          options: { tsConfig: `packages/${name}/tsconfig.build.json` }
        }
      },
      tags: ['keep'],
    })
    await write(`packages/${name}/tsconfig.json`, {
      extends: '../../tsconfig.base.json',
      compilerOptions: {
        noEmit: true,
        composite: false,
        rootDir: '../..',
        ...(name === 'custom' ? { jsx: 'react-jsx' } : {}),
      },
      include: ['src/**/*.ts'],
    })
    await write(`packages/${name}/tsconfig.build.json`, {
      extends: '../../tsconfig.base.json',
      compilerOptions: {
        rootDir: './src',
        outDir: `../../dist/packages/${name}`
      },
      include: ['src/**/*.ts'],
    })
  }

  const read = async file => readFile(join(root, file), 'utf8')

  return {
    root,
    context,
    read,
    write
  }
}

test('migration consolidates generated configs, preserves custom configs, adds schemas, and is idempotent', async t => {
  const { root, context, read } = await workspace(t)
  const custom = await read('packages/custom/tsconfig.json')
  const build = await read('packages/plain/tsconfig.build.json')
  await migrate(context)
  await assert.rejects(stat(join(root, 'packages/plain/tsconfig.json')), { code: 'ENOENT' })
  assert.equal(await read('packages/custom/tsconfig.json'), custom)
  assert.equal(await read('packages/plain/tsconfig.build.json'), build)
  const project = JSON.parse(await read('packages/plain/project.json'))
  assert.equal(project.$schema, `https://unpkg.com/@isox-sh/core@${require('../../../dist/core/package.json').version}/schemas/project.schema.json`)
  assert.deepEqual(project.tags, ['keep'])
  assert.equal(JSON.parse(await read('packages/custom/project.json')).$schema, './custom-schema.json')
  const editor = await read('tsconfig.json')
  assert.deepEqual(JSON.parse(editor).include, ['./packages/plain/src/**/*.ts'])
  await migrate(context)
  assert.equal(await read('tsconfig.json'), editor)
})

test('migration validates the root config before deleting local configs or updating schemas', async t => {
  const { root, context, read } = await workspace(t)
  await writeFile(join(root, 'tsconfig.json'), '{broken')
  const editor = await read('packages/plain/tsconfig.json')
  const project = await read('packages/plain/project.json')
  await assert.rejects(migrate(context), /Invalid TypeScript configuration/)
  assert.equal(await read('packages/plain/tsconfig.json'), editor)
  assert.equal(await read('packages/plain/project.json'), project)
})

test('published migration is planned and executable through the migration runner', async t => {
  const { root, read, write } = await workspace(t)
  const packageRoot = 'node_modules/@isox-sh/js'
  const manifest = require('../../../dist/js/package.json')
  const registry = require('../../../dist/js/migrations.json')
  const entry = registry.migrations['workspace-tsconfig']
  assert.equal(registry.migrations['workspace-tsconfig'].implementation, './migrations/workspace-tsconfig.js')
  await write(`${packageRoot}/package.json`, {
    ...manifest,
    version: '1.0.0-alpha.4'
  })
  await write('package.json', { devDependencies: { '@isox-sh/js': '1.0.0-alpha.4' } })
  await planMigrations(root, entry.version, async () => ({
    version: entry.version,
    migrations: registry.migrations
  }))
  assert.deepEqual(JSON.parse(await read('migrations.json')).migrations.map(({ name }) => name), ['workspace-tsconfig'])
  // Resolve the actual built implementation and its dependencies from the test installation.
  await write(`${packageRoot}/migrations.json`, {
    migrations: {
      'workspace-tsconfig': {
        ...entry,
        implementation: resolve(import.meta.dirname, '../../../dist/js/migrations/workspace-tsconfig.js')
      }
    }
  })
  await write(`${packageRoot}/package.json`, {
    ...manifest,
    version: entry.version
  })
  await runMigrations(root)
  await assert.rejects(stat(join(root, 'packages/plain/tsconfig.json')), { code: 'ENOENT' })
  assert.ok(JSON.parse(await read('tsconfig.json')).compilerOptions.noEmit)
})

test('migration retains an editor config that a customized build extends', async t => {
  const { context, read, write } = await workspace(t)
  await write('packages/plain/tsconfig.build.json', { extends: './tsconfig.json' })
  const original = await read('packages/plain/tsconfig.json')
  await migrate(context)
  assert.equal(await read('packages/plain/tsconfig.json'), original)
  await assert.rejects(read('tsconfig.json'), { code: 'ENOENT' })
})
