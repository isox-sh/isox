import assert from 'node:assert/strict'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'

import { test } from 'vitest'

import { planMigrations, runMigrations } from '../../../dist/core/migration/index.js'

async function fixture(t) {
  const root = await mkdtemp(join(tmpdir(), 'isox-migration-'))
  t.onTestFinished(() => rm(root, {
    recursive: true,
    force: true
  }))
  const write = async (file, value) => {
    await mkdir(dirname(join(root, file)), { recursive: true })
    await writeFile(join(root, file), typeof value === 'string' ? value : JSON.stringify(value))
  }

  await write('package.json', {
    devDependencies: {
      '@isox-sh/core': '^1.0.0',
      other: '1.0.0'
    }
  })
  await write('node_modules/@isox-sh/core/package.json', { version: '1.0.0' })

  return {
    root,
    write,
    read: async file => JSON.parse(await readFile(join(root, file), 'utf8'))
  }
}

const migration = version => ({
  version,
  implementation: './update.cjs'
})

test('plans only intervening versions, preserves ranges, and protects existing plans', async t => {
  const { root, read } = await fixture(t)
  await planMigrations(root, 'latest', async () => ({
    version: '2.0.0',
    migrations: {
      future: migration('3.0.0'),
      last: migration('2.0.0'),
      old: migration('1.0.0'),
      first: migration('1.1.0')
    }
  }))
  assert.deepEqual((await read('migrations.json')).migrations.map(entry => entry.name), ['first', 'last'])
  assert.deepEqual((await read('package.json')).devDependencies, {
    '@isox-sh/core': '^2.0.0',
    other: '1.0.0'
  })
  await assert.rejects(planMigrations(root, 'latest'), /already exists/)
})

test('resolves latest once and leaves files untouched when resolution fails', async t => {
  const { root, write, read } = await fixture(t)
  const manifest = {
    dependencies: {
      '@isox-sh/core': '~1.0.0',
      '@isox-sh/js': '1.0.0'
    }
  }
  await write('package.json', manifest)
  await write('node_modules/@isox-sh/js/package.json', { version: '1.0.0' })
  const calls = []
  await assert.rejects(planMigrations(root, 'latest', async (name, target) => {
    calls.push([name, target])
    if (name.endsWith('/js')) {
      throw new Error('registry unavailable')
    }

    return { version: '2.0.0' }
  }), /registry unavailable/)
  assert.deepEqual(calls, [['@isox-sh/core', 'latest'], ['@isox-sh/js', '2.0.0']])
  assert.deepEqual(await read('package.json'), manifest)
  await assert.rejects(read('migrations.json'), { code: 'ENOENT' })
})

test('rejects downgrades and malformed migration metadata without writing', async t => {
  const { root, read } = await fixture(t)
  await assert.rejects(planMigrations(root, '0.9.0', async () => ({ version: '0.9.0' })), /backwards/)
  await assert.rejects(planMigrations(root, '2.0.0', async () => ({
    version: '2.0.0',
    migrations: { bad: { version: 'oops' } }
  })), /Invalid migration/)
  assert.equal((await read('package.json')).devDependencies['@isox-sh/core'], '^1.0.0')
  await assert.rejects(read('migrations.json'), { code: 'ENOENT' })
})

test('runs a reviewed plan in order, awaits scripts, and can rerun it', async t => {
  const { root, write } = await fixture(t)
  await write('node_modules/@isox-sh/core/package.json', {
    version: '2.0.0',
    migrations: './config/migrations.json'
  })
  await write('node_modules/@isox-sh/core/config/migrations.json', {
    migrations: {
      update: {
        version: '2.0.0',
        implementation: '../update.cjs'
      }
    }
  })
  await write('node_modules/@isox-sh/core/update.cjs', `module.exports = async ({ workspaceRoot, logger }) => {
    await require('node:fs/promises').writeFile(require('node:path').join(workspaceRoot, 'result'), 'updated')
    if (typeof logger.info !== 'function') throw new Error('missing logger')
  }`)
  const entry = {
    package: '@isox-sh/core',
    name: 'update',
    version: '2.0.0'
  }
  await write('migrations.json', { migrations: [entry] })
  await runMigrations(root)
  await runMigrations(root)
  assert.equal(await readFile(join(root, 'result'), 'utf8'), 'updated')
  await rm(join(root, 'result'))
  await write('migrations.json', {
    migrations: [entry, {
      ...entry,
      name: 'missing'
    }]
  })
  await assert.rejects(runMigrations(root), /does not match/)
  await assert.rejects(readFile(join(root, 'result')), { code: 'ENOENT' })
})

test('if-exists only skips missing plans, and an outdated installation is rejected', async t => {
  const { root, write } = await fixture(t)
  await runMigrations(root, 'missing.json', true)
  await assert.rejects(runMigrations(root), { code: 'ENOENT' })
  await write('migrations.json', '{bad')
  await assert.rejects(runMigrations(root, 'migrations.json', true), /Invalid JSON/)
  await write('migrations.json', {
    migrations: [{
      package: '@isox-sh/core',
      name: 'update',
      version: '2.0.0'
    }]
  })
  await assert.rejects(runMigrations(root), /Install the updated/)
})

test('failed migrations stop subsequent scripts and invalidate cached discovery', async t => {
  const { root, write, read } = await fixture(t)
  await write('node_modules/@isox-sh/core/package.json', {
    version: '2.0.0',
    migrations: './migrations.json'
  })
  await write('node_modules/@isox-sh/core/migrations.json', {
    migrations: {
      fail: {
        version: '2.0.0',
        implementation: './fail.cjs'
      },
      later: {
        version: '2.0.0',
        implementation: './later.cjs'
      },
    }
  })
  await write('node_modules/@isox-sh/core/fail.cjs', "module.exports = async () => { throw new Error('migration failed') }")
  await write('node_modules/@isox-sh/core/later.cjs', "module.exports = ({ workspaceRoot }) => require('node:fs').writeFileSync(require('node:path').join(workspaceRoot, 'later'), '')")
  const plan = {
    migrations: ['fail', 'later'].map(name => ({
      package: '@isox-sh/core',
      name,
      version: '2.0.0'
    }))
  }
  await write('migrations.json', plan)
  await write('.isox/workspace.json', {})
  await assert.rejects(runMigrations(root), /migration failed/)
  await assert.rejects(readFile(join(root, 'later')), { code: 'ENOENT' })
  await assert.rejects(read('.isox/workspace.json'), { code: 'ENOENT' })
  assert.deepEqual(await read('migrations.json'), plan)
})

test('migration cleanup removes a directory-shaped discovery cache', async t => {
  const { root, write } = await fixture(t)
  await write('migrations.json', { migrations: [] })
  await write('.isox/workspace.json/corrupt', 'invalid cache')
  await runMigrations(root)
  await assert.rejects(readFile(join(root, '.isox/workspace.json')), { code: 'ENOENT' })
})

test('Windows npm resolution honors PATH, falls back beside Node, and reports missing npm', async t => {
  const { npmCommand } = await import('../../../dist/core/migration/npm-command.js')
  const { root, write } = await fixture(t)
  const executable = join(root, 'node/node.exe')
  const besideNode = join(root, 'node/node_modules/npm/bin/npm-cli.js')
  const onPath = join(root, 'bin/node_modules/npm/bin/npm-cli.js')
  assert.throws(() => npmCommand('win32', executable, join(root, 'missing')), /Cannot locate npm/)
  await write('node/node_modules/npm/bin/npm-cli.js', '')
  assert.deepEqual(npmCommand('win32', executable, ''), [executable, [besideNode]])
  await write('bin/node_modules/npm/bin/npm-cli.js', '')
  assert.deepEqual(npmCommand('win32', executable, `${join(root, 'missing')};${join(root, 'bin')}`), [executable, [onPath]])
})
