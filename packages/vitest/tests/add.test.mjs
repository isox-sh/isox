import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { mkdir, mkdtemp, readFile, rm, symlink, writeFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'

import { test } from 'vitest'

const require = createRequire(import.meta.url)
const { default: add } = require('../../../dist/vitest/generators/add')
const { createLogger, parseWorkspace } = require('../../../dist/core')
const cli = resolve(import.meta.dirname, '../../../dist/cli/index.js')

async function fixture(t, target) {
  const root = await mkdtemp(join(tmpdir(), 'isox-vitest-add-'))
  const projectRoot = join(root, 'apps/demo')
  const logger = createLogger({ level: -Infinity })
  const context = {
    workspaceRoot: root,
    projectRoot,
    projectName: 'demo',
    logger
  }
  const write = async (file, value) => {
    await mkdir(dirname(join(root, file)), { recursive: true })
    await writeFile(join(root, file), JSON.stringify(value))
  }

  const read = async file => JSON.parse(await readFile(join(root, file), 'utf8'))

  t.onTestFinished(() => rm(root, {
    recursive: true,
    force: true
  }))
  await write('isox.json', {
    version: '1',
    custom: { owner: 'team' }
  })
  await write('apps/demo/project.json', {
    name: 'demo',
    tags: ['library'],
    targets: {
      build: { executor: 'js:tsc' },
      ...(target ? { test: target } : {}),
    }
  })

  return {
    root,
    projectRoot,
    context,
    write,
    read
  }
}

test('adds the shorthand target, registers cache defaults once, and preserves metadata', async t => {
  const f = await fixture(t)

  await add({}, f.context)
  assert.deepEqual(await f.read('apps/demo/project.json'), {
    name: 'demo',
    tags: ['library'],
    targets: {
      build: { executor: 'js:tsc' },
      test: { executor: 'vitest:test' },
    }
  })
  assert.deepEqual(await f.read('isox.json'), {
    version: '1',
    custom: { owner: 'team' },
    targetDefaults: {
      'vitest:test': {
        cache: true
      }
    },
  })
  const project = await readFile(join(f.projectRoot, 'project.json'), 'utf8')
  const settings = await readFile(join(f.root, 'isox.json'), 'utf8')

  await add({}, f.context)
  assert.equal(await readFile(join(f.projectRoot, 'project.json'), 'utf8'), project)
  assert.equal(await readFile(join(f.root, 'isox.json'), 'utf8'), settings)
})

test('existing scoped targets and explicit workspace defaults are preserved', async t => {
  const target = {
    executor: '@isox-sh/vitest:test',
    cache: false,
    options: { configFile: 'custom.ts' },
    configurations: { acc: { configFile: 'acc.ts' } }
  }
  const f = await fixture(t, target)
  const defaults = {
    cache: false,
    outputs: ['coverage'],
    inputs: ['tests/**']
  }

  await f.write('isox.json', { targetDefaults: { '@isox-sh/vitest:test': defaults } })
  await add({}, f.context)
  assert.deepEqual((await f.read('apps/demo/project.json')).targets.test, target)
  assert.deepEqual((await f.read('isox.json')).targetDefaults, { '@isox-sh/vitest:test': defaults })
})

test('a different test executor fails without modifying either file', async t => {
  const f = await fixture(t, {
    executor: 'core:run-command',
    options: { command: 'custom' }
  })
  const before = await f.read('apps/demo/project.json')
  const settings = await f.read('isox.json')

  await assert.rejects(add({}, f.context), /different test target/)
  assert.deepEqual(await f.read('apps/demo/project.json'), before)
  assert.deepEqual(await f.read('isox.json'), settings)
})

test('the CLI loads the packaged generator by project name and invalidates stale definitions', async t => {
  const f = await fixture(t)
  const link = join(f.root, 'node_modules/@isox-sh/vitest')

  await mkdir(dirname(link), { recursive: true })
  await symlink(resolve(import.meta.dirname, '../../../dist/vitest'), link, process.platform === 'win32' ? 'junction' : 'dir')
  await parseWorkspace(f.root, { logger: f.context.logger })
  const result = spawnSync(process.execPath, [cli, 'add', '@isox-sh/vitest', 'demo'], {
    cwd: f.root,
    encoding: 'utf8'
  })

  assert.equal(result.status, 0, result.stderr)
  await assert.rejects(readFile(join(f.root, '.isox/workspace.json')), { code: 'ENOENT' })
  const workspace = await parseWorkspace(f.root, { logger: f.context.logger })

  assert.deepEqual(workspace.projects.demo.targets.test, {
    executor: 'vitest:test',
    cache: true
  })
})
