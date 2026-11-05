import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { mkdir, mkdtemp, readdir, readFile, rm, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'

import { onTestFinished, test } from 'vitest'

import { cacheSettings, refreshDefinitions } from '../actions/cache/prepare.mjs'

async function fixture(t = { onTestFinished }) {
  const root = await mkdtemp(join(tmpdir(), 'isox cache action '))

  t.onTestFinished(() => rm(root, {
    recursive: true,
    force: true
  }))

  return root
}

test('compatible runners share a restore prefix but save independent snapshots', async t => {
  const firstRoot = await fixture(t)
  const secondRoot = await fixture(t)
  const settings = {
    root: firstRoot,
    platform: 'Linux',
    arch: 'X64'
  }
  const first = cacheSettings(settings)
  const second = cacheSettings({
    ...settings,
    root: secondRoot
  })

  assert.equal(first.prefix, second.prefix)
  assert.notEqual(first.key, second.key)
  assert.ok(first.key.startsWith(second.prefix))
  assert.equal(first.path, join(firstRoot, '.isox'))
  assert.equal(second.path, join(secondRoot, '.isox'))

  for (const override of [
    { platform: 'Windows' },
    { arch: 'ARM64' },
    { directory: 'nested' },
    { namespace: 'new-format' },
  ]) {
    assert.notEqual(cacheSettings({
      ...settings,
      ...override
    }).prefix, first.prefix)
  }
})

test('cache setup rejects locations outside the checkout and invalid namespaces', async t => {
  const root = await fixture(t)
  const settings = {
    root,
    platform: 'Linux',
    arch: 'X64'
  }

  for (const directory of ['../outside', resolve(root, '..', 'other'), root, join(root, 'nested')]) {
    assert.throws(() => cacheSettings({
      ...settings,
      directory
    }), /inside GITHUB_WORKSPACE/)
  }

  for (const namespace of ['', 'cache\nkey=injected', 'cache/path', 'a'.repeat(101)]) {
    assert.throws(() => cacheSettings({
      ...settings,
      namespace
    }), /prefix must contain/)
  }

  assert.throws(() => cacheSettings({
    ...settings,
    arch: undefined
  }), /RUNNER_OS and RUNNER_ARCH/)
})

test('refreshing restored definitions preserves dependency analysis and future task cache entries', async t => {
  const root = await fixture(t)
  const path = join(root, '.isox')

  await mkdir(join(path, 'tasks/hash'), { recursive: true })
  await writeFile(join(path, 'workspace.json'), '{"projects":{"removed":{}}}')
  await writeFile(join(path, 'discovery.json'), 'dependency entries')
  await writeFile(join(path, 'tasks/hash/result'), 'cached task result')
  await refreshDefinitions(path)
  await assert.rejects(stat(join(path, 'workspace.json')), { code: 'ENOENT' })
  assert.equal(await readFile(join(path, 'discovery.json'), 'utf8'), 'dependency entries')
  assert.equal(await readFile(join(path, 'tasks/hash/result'), 'utf8'), 'cached task result')
  await refreshDefinitions(path)
  await refreshDefinitions(join(root, 'missing'))
})

test('the action entry point exports cross-commit keys and refreshes only the selected workspace', async t => {
  const root = await fixture(t)
  const output = join(root, 'outputs')
  const script = resolve('actions/cache/prepare.mjs')
  const env = {
    ...process.env,
    GITHUB_WORKSPACE: root,
    GITHUB_OUTPUT: output,
    GITHUB_ENV: join(root, 'environment'),
    INPUT_WORKINGDIRECTORY: 'nested workspace',
    INPUT_PREFIX: 'shared',
    RUNNER_OS: 'Linux',
    RUNNER_ARCH: 'X64'
  }
  const snapshots = []

  for (const sha of ['first-commit', 'second-commit']) {
    await writeFile(output, '')
    const result = spawnSync(process.execPath, [script], {
      env: {
        ...env,
        GITHUB_SHA: sha
      },
      encoding: 'utf8'
    })

    assert.equal(result.status, 0, result.stderr)
    snapshots.push(Object.fromEntries((await readFile(output, 'utf8')).trim().split('\n').map(line => {
      const index = line.indexOf('=')

      return [line.slice(0, index), line.slice(index + 1)]
    })))
  }

  assert.equal(snapshots[0].prefix, snapshots[1].prefix)
  assert.notEqual(snapshots[0].key, snapshots[1].key)
  const path = snapshots[0].path

  await mkdir(path, { recursive: true })
  await writeFile(join(path, 'workspace.json'), 'old definitions')
  const refresh = spawnSync(process.execPath, [script, 'refresh'], {
    env: {
      ...env,
      ISOX_CACHE_PATH: path
    },
    encoding: 'utf8'
  })

  assert.equal(refresh.status, 0, refresh.stderr)
  await assert.rejects(stat(join(path, 'workspace.json')), { code: 'ENOENT' })
})

test('refreshing a directory-shaped definitions cache preserves its contents for recovery', async t => {
  const root = await fixture(t)
  const path = join(root, '.isox')

  await mkdir(join(path, 'workspace.json'), { recursive: true })
  await writeFile(join(path, 'workspace.json/keep'), 'preserved')
  await refreshDefinitions(path)
  await assert.rejects(stat(join(path, 'workspace.json')), { code: 'ENOENT' })
  const backups = await readdir(path)

  assert.equal(backups.length, 1)
  assert.match(backups[0], /^workspace\.json\..+\.invalid$/)
  assert.equal(await readFile(join(path, backups[0], 'keep'), 'utf8'), 'preserved')
})

test.each(['.', 'nested workspace'])('restore and post-job save use the same cache version for %s', async directory => {
  const root = await fixture()
  const output = join(root, 'outputs')
  const environment = join(root, 'environment')
  const result = spawnSync(process.execPath, [resolve('actions/cache/prepare.mjs')], {
    env: {
      ...process.env,
      GITHUB_WORKSPACE: root,
      GITHUB_OUTPUT: output,
      GITHUB_ENV: environment,
      INPUT_WORKINGDIRECTORY: directory,
      RUNNER_OS: 'Linux',
      RUNNER_ARCH: 'X64'
    },
    encoding: 'utf8'
  })

  assert.equal(result.status, 0, result.stderr)
  const jobEnvironment = Object.fromEntries((await readFile(environment, 'utf8')).trim().split('\n').map(line => {
    const separator = line.indexOf('=')

    return [line.slice(0, separator), line.slice(separator + 1)]
  }))
  const action = await readFile('actions/cache/action.yml', 'utf8')
  const expression = action.match(/^ {8}path: (.+)$/m)[1]
  const evaluate = context => expression.replace(/\$\{\{\s*(\w+)\.(\w+)\s*\}\}/g, (_, scope, name) => context[scope]?.[name] ?? '')
  const restorePath = evaluate({
    github: { workspace: root },
    inputs: { workingDirectory: directory },
    env: jobEnvironment
  })
  // Nested post actions re-evaluate with inputs/steps missing, but retain the job environment.
  const postPath = evaluate({
    github: { workspace: root },
    inputs: {},
    steps: {},
    env: jobEnvironment
  })
  const cacheVersion = path => createHash('sha256').update([path, 'zstd-without-long', '1.0'].join('|')).digest('hex')

  assert.equal(restorePath, join(root, directory, '.isox'))
  assert.equal(postPath, restorePath)
  assert.equal(cacheVersion(postPath), cacheVersion(restorePath))
  assert.notEqual(cacheVersion(`${root}/./.isox`), cacheVersion(`${root}//.isox`))
})
