import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { mkdir, mkdtemp, readFile, rm, symlink, writeFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'

import { test } from 'vitest'

const dist = resolve(import.meta.dirname, '../../../dist')
const require = createRequire(import.meta.url)

async function fixture(t) {
  const root = await mkdtemp(join(tmpdir(), 'isox playwright '))
  const write = async (file, content) => {
    const path = join(root, file)
    await mkdir(dirname(path), { recursive: true })
    await writeFile(path, typeof content === 'string' ? content : JSON.stringify(content))
  }

  t.onTestFinished(() => rm(root, {
    recursive: true,
    force: true
  }))
  for (const [pkg, location] of [
    ['@isox-sh/playwright', join(dist, 'playwright')],
    ['@playwright/test', dirname(require.resolve('@playwright/test/package.json'))],
  ]) {
    const link = join(root, 'node_modules', pkg)

    await mkdir(dirname(link), { recursive: true })
    await symlink(location, link, 'junction')
  }

  await write('isox.json', {})
  await write('apps/web/project.json', { name: 'web' })
  const run = (...args) => spawnSync(process.execPath, [join(dist, 'cli/index.js'), ...args], {
    cwd: root,
    encoding: 'utf8',
    timeout: 20_000
  })
  const success = (...args) => {
    const result = run(...args)
    assert.equal(result.status, 0, result.stderr + result.stdout)

    return result.stdout
  }

  success('add', '@isox-sh/playwright', 'web')

  return {
    root,
    write,
    run,
    success
  }
}

test('declares the plugin and its test runner and preserves workspace version pins on repeated add', async t => {
  const { root, write, success } = await fixture(t)
  const plugin = require('../../../dist/playwright/package.json')
  const manifest = join(root, 'package.json')
  assert.deepEqual(JSON.parse(await readFile(manifest, 'utf8')).devDependencies, {
    '@isox-sh/playwright': plugin.version,
    '@playwright/test': plugin.peerDependencies['@playwright/test']
  })

  // An existing e2e target still needs its dependency declarations repaired.
  await write('package.json', { dependencies: { '@playwright/test': 'catalog:' } })
  success('add', '@isox-sh/playwright', 'web')
  assert.deepEqual(JSON.parse(await readFile(manifest, 'utf8')), {
    dependencies: { '@playwright/test': 'catalog:' },
    devDependencies: { '@isox-sh/playwright': plugin.version }
  })
  await assert.rejects(readFile(join(root, 'apps/web/package.json')), { code: 'ENOENT' })
})

test('respects the shared job budget and a shard pinned by configuration', async t => {
  const { write, success, run } = await fixture(t)
  await write('apps/api/project.json', {
    name: 'api',
    targets: { e2e: { executor: 'core:run-command' } }
  })
  await write('apps/web/project.json', {
    name: 'web',
    targets: {
      e2e: {
        executor: '@isox-sh/playwright:test',
        configurations: { pinned: { shard: '2/5' } },
      }
    }
  })
  const plan = () => JSON.parse(success('plan', '--all', '--target=e2e', '--max-jobs=4')).include

  for (const name of ['one', 'two', 'three']) {
    await write(`apps/web/${name}.spec.cjs`, "require('@playwright/test').test('example', () => {})")
  }

  assert.deepEqual(plan().map(row => row.options?.shard), [undefined, '1/3', '2/3', '3/3'])
  await write('apps/api/project.json', { name: 'api' })
  const pinned = JSON.parse(success('plan', '--all', '--target=e2e', '--max-jobs=4', '--config=pinned')).include

  assert.equal(pinned.length, 1)
  assert.equal(pinned[0].config, 'pinned')
  assert.equal(pinned[0].options, undefined)
  const invalid = run('e2e', 'web', '--shard=3/2')
  assert.equal(invalid.status, 1)
  assert.match(invalid.stderr, /shard index/)
})

test('reserves explicit shards before other projects with or without a target budget', async t => {
  const { write, success, run } = await fixture(t)
  await write('apps/web/project.json', {
    name: 'web',
    targets: {
      e2e: {
        executor: 'playwright:test',
        planner: { shards: 3 }
      }
    }
  })
  for (const args of [
    ['--target=e2e'], ['--targets-json=[{"target":"e2e"}]'], ['--target=e2e', '--max-jobs=8']
  ]) {
    const rows = JSON.parse(success('plan', '--all', ...args)).include
    assert.deepEqual(rows.map(row => row.options.shard), ['1/3', '2/3', '3/3'])
  }

  await write('apps/api/project.json', {
    name: 'api',
    targets: { e2e: { executor: 'core:run-command' } }
  })
  const rows = JSON.parse(success('plan', '--all', '--target=e2e')).include
  assert.deepEqual(rows.map(row => row.projects), [['web'], ['web'], ['web'], ['api']])
  const tooSmall = run('plan', '--all', '--target=e2e', '--max-jobs=3')
  assert.equal(tooSmall.status, 1)
  assert.match(tooSmall.stderr, /at least 4 jobs/)
  for (const shards of [0, -1, 1.5, '3', 'all', 257]) {
    await write('apps/web/project.json', {
      name: 'web',
      targets: {
        e2e: {
          executor: 'playwright:test',
          planner: { shards }
        }
      }
    })
    assert.match(run('plan', '--all', '--target=e2e').stderr, /Playwright planner\.shards/)
  }
})

test('reads the shard count only from planner settings and prefers a local count over workspace defaults', async t => {
  const { root, write, success } = await fixture(t)
  const generated = JSON.parse(await readFile(join(root, 'apps/web/project.json'), 'utf8'))
  assert.deepEqual(generated.targets.e2e, {
    executor: 'playwright:test',
    planner: { shards: 'auto' }
  })

  const plan = () => JSON.parse(success('plan', '--all', '--target=e2e')).include.map(row => row.options)
  const setTarget = target => write('apps/web/project.json', {
    name: 'web',
    targets: {
      e2e: {
        executor: 'playwright:test',
        ...target
      }
    }
  })
  await setTarget({ options: { shards: 2 } })
  assert.deepEqual(plan(), [undefined])
  await setTarget({})
  await write('isox.json', { targetDefaults: { 'playwright:test': { planner: { shards: 3 } } } })
  assert.deepEqual(plan(), [{ shard: '1/3' }, { shard: '2/3' }, { shard: '3/3' }])
  await setTarget({ planner: { shards: 2 } })
  assert.deepEqual(plan(), [{ shard: '1/2' }, { shard: '2/2' }])
})

test('auto checks actual Playwright assignments using the configured test directory', async t => {
  const { write, success, run } = await fixture(t)
  await write('apps/web/project.json', {
    name: 'web',
    targets: {
      e2e: {
        executor: 'playwright:test',
        planner: { shards: 'auto' },
        options: { configFile: 'custom.cjs' }
      }
    }
  })
  const list = () => JSON.parse(success('plan', '--all', '--target=e2e', '--max-jobs=8')).include
  await write('custom.cjs', "module.exports = { testDir: './specs' }")
  await write('apps/web/ignored.spec.cjs', "throw Error('wrong discovery root')")
  assert.deepEqual(list().map(row => row.options), [undefined])
  await write('specs/example.spec.cjs', "const { test } = require('@playwright/test'); test.skip('later', () => {})")
  assert.deepEqual(list().map(row => row.options), [undefined])
  await write('specs/example.spec.cjs', `
    const { test } = require('@playwright/test')
    test('one', () => {})
    test('two', () => {})
    test.skip('later', () => {})
  `)
  assert.deepEqual(list().map(row => row.options), [undefined])
  // Two tests stay together in the first file, leaving the middle shard empty.
  await write('specs/second.spec.cjs', "require('@playwright/test').test('another', () => {})")
  assert.deepEqual(list().map(row => row.options.shard), ['1/3', '3/3'])
  await write('custom.cjs', "module.exports = { testDir: './specs', testMatch: 'example.spec.cjs', fullyParallel: true }")
  assert.deepEqual(list().map(row => row.options.shard), ['1/2', '2/2'])
  await write('specs/example.spec.cjs', "throw Error('bad test import')")
  const failed = run('plan', '--all', '--target=e2e', '--max-jobs=8')
  assert.equal(failed.status, 1)
  assert.equal(failed.stdout, '')
  assert.match(failed.stderr, /bad test import/)
})
