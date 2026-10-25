import assert from 'node:assert/strict'
import { readFile, stat } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { join } from 'node:path'

import { test } from 'vitest'

import { fixture } from './fixture.mjs'

const require = createRequire(import.meta.url)
const { default: add } = require('../../../dist/semver/generators/add')

test('installed release generator adds version without changing existing project fields or package metadata', async t => {
  const f = await fixture(t)
  const original = {
    name: 'demo',
    $schema: '../../node_modules/nx/schemas/project-schema.json',
    targets: {
      build: {
        executor: 'core:run-command',
        options: { command: 'echo build' }
      },
      inferred: { custom: 'keep' }
    },
    tags: ['library'],
    metadata: { owner: 'team' }
  }

  await f.write('packages/demo/project.json', original)
  const manifest = await readFile(join(f.context.projectRoot, 'package.json'), 'utf8')
  const result = f.run('add', '@isox-sh/semver', 'demo')

  assert.equal(result.status, 0, result.stderr)
  assert.match(result.stdout, /Updated file packages\/demo\/project.json/)
  const updated = JSON.parse(await readFile(join(f.context.projectRoot, 'project.json'), 'utf8'))

  assert.deepEqual(updated, {
    ...original,
    targets: {
      ...original.targets,
      version: { executor: 'semver:version' }
    }
  })
  assert.equal(await readFile(join(f.context.projectRoot, 'package.json'), 'utf8'), manifest)
  await assert.rejects(stat(join(f.root, '.isox/workspace.json')), { code: 'ENOENT' })
  const preview = f.run('version', 'demo', '--release-as=patch', '--dry-run')

  assert.equal(preview.status, 0, preview.stderr)
  assert.match(preview.stdout, /demo@1\.0\.1/)
})

test('generator works with no targets and preserves customized release targets on repeat calls', async t => {
  const f = await fixture(t)

  await f.write('packages/demo/project.json', {
    name: 'demo',
    custom: true
  })
  await add({}, f.context)
  const first = await readFile(join(f.context.projectRoot, 'project.json'), 'utf8')

  await add({}, f.context)
  assert.equal(await readFile(join(f.context.projectRoot, 'project.json'), 'utf8'), first)

  for (const executor of ['semver:version', '@isox-sh/semver:version']) {
    await f.write('packages/demo/project.json', {
      name: 'demo',
      targets: {
        version: {
          executor,
          options: {
            syncVersions: true,
            postTargets: ['github']
          }
        }
      }
    })
    const configured = await readFile(join(f.context.projectRoot, 'project.json'), 'utf8')

    await add({}, f.context)
    assert.equal(await readFile(join(f.context.projectRoot, 'project.json'), 'utf8'), configured)
  }
})

test('generator refuses a conflicting version target and malformed project objects without rewriting them', async t => {
  const f = await fixture(t)

  for (const project of [null, [], { targets: [] }, { targets: null }, { targets: { version: { executor: 'other:version' } } }, { targets: { version: null } }]) {
    await f.write('packages/demo/project.json', project)
    const before = await readFile(join(f.context.projectRoot, 'project.json'), 'utf8')

    await assert.rejects(add({}, f.context), /requires a project.json object|already has a different version target/)
    assert.equal(await readFile(join(f.context.projectRoot, 'project.json'), 'utf8'), before)
  }
})
