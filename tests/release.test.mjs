import assert from 'node:assert/strict'
import { mkdir, mkdtemp, realpath, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { test } from 'vitest'

import { release } from '../scripts/release.mjs'

const oidc = {
  GITHUB_ACTIONS: 'true',
  ACTIONS_ID_TOKEN_REQUEST_URL: 'https://example.invalid/token',
  ACTIONS_ID_TOKEN_REQUEST_TOKEN: 'fixture'
}

async function fixture(t) {
  const root = await realpath(await mkdtemp(join(tmpdir(), 'isox-release-')))
  const calls = []
  const run = (command, args, cwd) => calls.push({
    command,
    args,
    cwd
  })
  const write = async (directory, manifest) => {
    await mkdir(join(root, directory), { recursive: true })
    await writeFile(join(root, directory, 'package.json'), JSON.stringify(manifest))
  }

  const pkg = async (directory, dependencies = {}, version = '1.0.0-alpha.0') => {
    const manifest = {
      name: directory,
      version,
      dependencies
    }

    await write(`packages/${directory}`, {
      ...manifest,
      publishConfig: { directory: `../../dist/${directory}` }
    })
    await write(`dist/${directory}`, manifest)
  }

  t.onTestFinished(() => rm(root, {
    recursive: true,
    force: true
  }))
  await pkg('cli', { core: '1.0.0-alpha.0' })
  await pkg('core')
  await write('packages/private', {
    name: 'private',
    private: true
  })

  return {
    root,
    calls,
    run,
    write,
    pkg
  }
}

test('release builds first, checks every package, then publishes dependencies before consumers', async t => {
  const { root, calls, run } = await fixture(t)

  await release({
    root,
    tag: 'alpha',
    version: '1.0.0-alpha.0'
  }, run, oidc)
  assert.deepEqual(calls[0], {
    command: 'pnpm',
    args: ['bootstrap'],
    cwd: root
  })
  assert.deepEqual(calls.slice(1).map(call => [call.args[0], call.cwd]), [
    ['pack', join(root, 'dist/core')],
    ['pack', join(root, 'dist/cli')],
    ['publish', join(root, 'dist/core')],
    ['publish', join(root, 'dist/cli')]
  ])
  assert.deepEqual(calls[3].args, ['publish', '--access', 'public', '--tag', 'alpha', '--registry', 'https://registry.npmjs.org/', '--provenance', '--ignore-scripts'])
})

test('dry run checks packages locally without OIDC or a publish command', async t => {
  const { root, calls, run } = await fixture(t)

  await release({
    root,
    tag: 'alpha',
    dryRun: true
  }, run, {})
  assert.deepEqual(calls.map(call => call.args[0]), ['bootstrap', 'pack', 'pack'])
})

test('latest publishes with OIDC and supports local dry runs', async t => {
  const { root, calls, run, pkg } = await fixture(t)

  await pkg('core', {}, '1.0.0')
  await pkg('cli', { core: '1.0.0' }, '1.0.0')
  await release({
    root,
    tag: 'latest'
  }, run, oidc)
  assert.equal(calls.filter(call => call.args[0] === 'publish').length, 2)
  calls.length = 0
  await release({
    root,
    tag: 'latest',
    dryRun: true
  }, run, {})
  assert.deepEqual(calls.map(call => call.args[0]), ['bootstrap', 'pack', 'pack'])
})

test('alpha and beta publish to their matching channels', async t => {
  const { root, calls, run, pkg } = await fixture(t)

  for (const tag of ['alpha', 'beta']) {
    const version = `1.0.0-${tag}.0`

    await pkg('core', {}, version)
    await pkg('cli', { core: version }, version)
    calls.length = 0
    await release({
      root,
      tag
    }, run, oidc)
    assert.equal(calls.filter(call => call.args[0] === 'publish').length, 2)
  }
})

test('publishing rejects missing OIDC and unsupported tags before building', async t => {
  const { root, calls, run } = await fixture(t)

  await assert.rejects(release({
    root,
    tag: 'alpha'
  }, run, {}), /GitHub Actions OIDC/)
  await assert.rejects(release({
    root,
    tag: 'invalid',
    dryRun: true
  }, run), /Choose --tag/)
  assert.deepEqual(calls, [])
})

test('release rejects mismatched versions and prerelease channels before publishing', async t => {
  const { root, calls, run } = await fixture(t)

  for (const options of [{
    tag: 'alpha',
    version: '2.0.0'
  }, { tag: 'latest' }, { tag: 'beta' }]) {
    await assert.rejects(release({
      root,
      ...options
    }, run, oidc), /expected|does not match/)
  }

  assert.ok(calls.every(call => call.args[0] === 'bootstrap'))
})

test('release rejects stale outputs, source directory publication, and unresolved workspace dependencies', async t => {
  const { root, calls, run, write, pkg } = await fixture(t)

  await write('dist/cli', {
    name: 'cli',
    version: '0.0.1'
  })
  await assert.rejects(release({
    root,
    tag: 'alpha'
  }, run, oidc), /does not match/)
  await pkg('cli', { core: 'workspace:*' })
  await assert.rejects(release({
    root,
    tag: 'alpha'
  }, run, oidc), /unpublished dependency/)
  await write('packages/cli', {
    name: 'cli',
    version: '1.0.0-alpha.0',
    publishConfig: { directory: '.' }
  })
  await assert.rejects(release({
    root,
    tag: 'alpha'
  }, run, oidc), /inside dist/)
  assert.ok(calls.every(call => call.args[0] === 'bootstrap'))
})

test('a failed package preflight prevents publishing all packages', async t => {
  const { root, calls, run } = await fixture(t)

  await assert.rejects(release({
    root,
    tag: 'alpha'
  }, (command, args, cwd) => {
    run(command, args, cwd)

    if (args[0] === 'pack' && cwd.endsWith('/cli')) {
      throw new Error('Invalid tarball')
    }
  }, oidc), /Invalid tarball/)
  assert.ok(calls.every(call => call.args[0] !== 'publish'))
})
