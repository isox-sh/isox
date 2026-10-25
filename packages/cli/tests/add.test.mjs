import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { mkdir, mkdtemp, readFile, rm, stat, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'

import { test } from 'vitest'

const cli = resolve(import.meta.dirname, '../../../dist/cli/index.js')

async function fixture(t) {
  const temporary = await mkdtemp(join(tmpdir(), 'isox-add-'))
  const root = join(temporary, 'workspace')
  const projectRoot = join(root, 'existing/project')

  t.onTestFinished(() => rm(temporary, {
    recursive: true,
    force: true
  }))
  const write = async (path, content) => {
    const file = join(root, path)

    await mkdir(dirname(file), { recursive: true })
    await writeFile(file, typeof content === 'string' ? content : JSON.stringify(content))
  }

  await write('isox.json', {})
  await write('existing/project/project.json', {
    name: 'named-project',
    custom: { keep: true }
  })
  await write('node_modules/plugin/package.json', {
    name: 'plugin',
    exports: { '.': './public.cjs' },
    generators: './metadata/generators.json'
  })
  await write('node_modules/plugin/metadata/generators.json', { generators: { add: { implementation: '../add.cjs' } } })
  await write('node_modules/plugin/add.cjs', `module.exports = async (options, context) => {
    const fs = require('node:fs/promises')
    await fs.writeFile(require('node:path').join(context.projectRoot, 'added.json'), JSON.stringify({ options, projectName: context.projectName, projectRoot: context.projectRoot, workspaceRoot: context.workspaceRoot }))
  }`)
  const run = (cwd, ...args) => spawnSync(process.execPath, [cli, ...args], {
    cwd,
    encoding: 'utf8',
    timeout: 30_000
  })

  return {
    root,
    projectRoot,
    write,
    run
  }
}

test('add loads an installed generator with hidden package exports and refreshes only workspace discovery', async t => {
  const f = await fixture(t)

  await f.write('.isox/workspace.json', { stale: true })
  await f.write('.isox/keep', 'build cache')
  const result = f.run(f.root, 'add', 'plugin', 'named-project')

  assert.equal(result.status, 0, result.stderr)
  const added = JSON.parse(await readFile(join(f.projectRoot, 'added.json'), 'utf8'))

  assert.equal(added.projectName, 'named-project')
  assert.ok(added.projectRoot.endsWith('/existing/project'))
  assert.deepEqual(added.options, {})
  assert.equal(await readFile(join(f.root, '.isox/keep'), 'utf8'), 'build cache')
  await assert.rejects(stat(join(f.root, '.isox/workspace.json')), { code: 'ENOENT' })
  assert.deepEqual(JSON.parse(await readFile(join(f.projectRoot, 'project.json'), 'utf8')), {
    name: 'named-project',
    custom: { keep: true }
  })
})

test('add resolves project names from nested directories and allows a root project', async t => {
  const f = await fixture(t)

  assert.equal(f.run(f.projectRoot, 'add', 'plugin', 'named-project').status, 0)
  await f.write('project.json', { name: 'workspace' })
  const result = f.run(f.projectRoot, 'add', 'plugin', 'workspace')

  assert.equal(result.status, 0, result.stderr)
  assert.equal(JSON.parse(await readFile(join(f.root, 'added.json'), 'utf8')).projectName, 'workspace')
})

test('add refuses missing projects, escaping directories, and symlinked project files', async t => {
  const f = await fixture(t)
  const outside = join(f.root, '../outside')

  await mkdir(outside)
  await writeFile(join(outside, 'project.json'), '{"name":"outside"}')
  await symlink(outside, join(f.root, 'escape'), 'junction')
  await mkdir(join(f.root, 'empty'))

  for (const name of ['missing', 'empty', 'existing/project', '../outside']) {
    const result = f.run(f.root, 'add', 'plugin', name)

    assert.equal(result.status, 1, name)
    assert.match(result.stderr, /not found in workspace/)
  }

  const escaped = f.run(f.root, 'add', 'plugin', 'outside')

  assert.equal(escaped.status, 1)
  assert.match(escaped.stderr, /must be inside/)
  await rm(join(f.root, 'escape'))
  await rm(join(f.projectRoot, 'project.json'))
  await symlink(join(outside, 'project.json'), join(f.projectRoot, 'project.json'))
  const result = f.run(f.root, 'add', 'plugin', 'outside')

  assert.equal(result.status, 1)
  assert.match(result.stderr, /symlink/)
  await assert.rejects(stat(join(outside, 'added.json')), { code: 'ENOENT' })
})

test('add invalidates discovery even if a generator fails after changing configuration', async t => {
  const f = await fixture(t)

  await f.write('node_modules/plugin/add.cjs', `module.exports = async (_, context) => {
    await require('node:fs/promises').writeFile(require('node:path').join(context.projectRoot, 'project.json'), '{"name":"changed"}')
    throw new Error('Generator failed')
  }`)
  const result = f.run(f.root, 'add', 'plugin', 'named-project')

  assert.equal(result.status, 1)
  assert.match(result.stderr, /Generator failed/)
  assert.equal(JSON.parse(await readFile(join(f.projectRoot, 'project.json'), 'utf8')).name, 'changed')
  await assert.rejects(stat(join(f.root, '.isox/workspace.json')), { code: 'ENOENT' })
})

test('add reports missing arguments, unsupported options, and missing or invalid plugin implementations', async t => {
  const f = await fixture(t)

  for (const args of [[], ['plugin'], ['plugin', 'named-project', 'extra'], ['plugin', 'named-project', '--unknown'], ['missing-plugin', 'named-project']]) {
    assert.equal(f.run(f.root, 'add', ...args).status, 1, args.join(' '))
  }

  await f.write('node_modules/plugin/package.json', { name: 'plugin' })
  const missing = f.run(f.root, 'add', 'plugin', 'named-project')

  assert.match(missing.stderr, /does not define a generators manifest/)
  await f.write('node_modules/plugin/package.json', {
    name: 'plugin',
    generators: './metadata/generators.json'
  })
  await f.write('node_modules/plugin/add.cjs', 'module.exports = {}')
  const invalid = f.run(f.root, 'add', 'plugin', 'named-project')

  assert.match(invalid.stderr, /does not export a function/)
  await assert.rejects(stat(join(f.projectRoot, 'added.json')), { code: 'ENOENT' })
})

test('add requires a workspace and refuses a symlinked workspace cache', async t => {
  const f = await fixture(t)

  await mkdir(join(f.root, '../cache'))
  await writeFile(join(f.root, '../cache/workspace.json'), 'keep')
  await symlink(join(f.root, '../cache'), join(f.root, '.isox'), 'junction')
  const symlinked = f.run(f.root, 'add', 'plugin', 'named-project')

  assert.equal(symlinked.status, 1)
  assert.match(symlinked.stderr, /symlinked .isox/)
  assert.equal(await readFile(join(f.root, '../cache/workspace.json'), 'utf8'), 'keep')
  await rm(join(f.root, 'isox.json'))
  const missing = f.run(f.root, 'add', 'plugin', 'named-project')

  assert.equal(missing.status, 1)
  assert.match(missing.stderr, /No Isox workspace/)
})

test('add rejects malformed generator registries and missing implementations before modifying projects', async t => {
  const f = await fixture(t)

  for (const registry of [null, [], {}, { generators: [] }, { generators: {} }, { generators: { add: './add.cjs' } }, { generators: { add: { implementation: '' } } }]) {
    await f.write('node_modules/plugin/metadata/generators.json', registry)
    const result = f.run(f.root, 'add', 'plugin', 'named-project')

    assert.equal(result.status, 1)
    assert.match(result.stderr, /Invalid generators manifest|must define an implementation/)
    await assert.rejects(stat(join(f.projectRoot, 'added.json')), { code: 'ENOENT' })
  }
})
