import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { join } from 'node:path'

import { test } from 'vitest'

import { fixture, planRelease, version } from './fixture.mjs'

const require = createRequire(import.meta.url)
const { nextVersion } = require('../../../dist/semver/executors/version/version')

test('prerelease bumps respect the pending stable version and explicit release versions', () => {
  for (const [current, bump, preid, expected] of [
    ['0.0.1', 'major', 'alpha', '1.0.0-alpha.0'],
    ['1.0.0', 'minor', 'alpha', '1.1.0-alpha.0'],
    ['1.0.0', 'patch', 'alpha', '1.0.1-alpha.0'],
    ['1.0.0-alpha.0', 'major', 'alpha', '1.0.0-alpha.1'],
    ['1.0.0-alpha.0', 'minor', 'alpha', '1.0.0-alpha.1'],
    ['1.0.0-alpha.9', 'patch', 'alpha', '1.0.0-alpha.10'],
    ['1.0.1-alpha.0', 'minor', 'alpha', '1.1.0-alpha.0'],
    ['1.1.0-alpha.0', 'major', 'alpha', '2.0.0-alpha.0'],
    ['1.0.0-alpha.9', 'patch', 'beta', '1.0.0-beta.0'],
    ['1.0.0', 'patch', 'alpha.preview', '1.0.1-alpha.preview.0'],
    ['1.0.0-alpha.1', 'patch', undefined, '1.0.0'],
    ['1.0.0-alpha.1', '1.0.0', 'alpha', '1.0.0'],
    ['1.0.0', '2.0.0-beta.3', 'alpha', '2.0.0-beta.3'],
  ]) {
    assert.equal(nextVersion(current, bump, preid), expected, `${current}: ${bump} (${preid})`)
  }
})

test('CLI synchronizes alpha manifests, tags and notes, increments with new commits, and promotes explicitly', async t => {
  const f = await fixture(t, '0.0.1')

  await f.write('package.json', {
    name: 'workspace',
    version: '0.0.0',
    private: true
  })
  await f.write('packages/other/package.json', {
    name: 'other',
    version: '0.0.1'
  })
  await f.write('packages/other/project.json', { name: 'other' })
  f.commit('feat!: Initial public API')

  for (const [extra, expected] of [
    [[], '1.0.0-alpha.0'],
    [[], '1.0.0-alpha.1'],
    [['--release-as=1.0.0'], '1.0.0'],
  ]) {
    const result = f.run('version', 'demo', '--sync-versions', '--preid=alpha', ...extra)

    assert.equal(result.status, 0, result.stderr + result.stdout)

    for (const path of ['.', 'packages/demo', 'packages/other']) {
      const manifest = JSON.parse(await readFile(join(f.root, path, 'package.json'), 'utf8'))

      assert.equal(manifest.version, expected)
      assert.ok((await readFile(join(f.root, path, 'CHANGELOG.md'), 'utf8')).includes(`## ${expected} (`))
    }

    assert.equal(f.git('rev-parse', `v${expected}^{}`), f.git('rev-parse', 'HEAD'))
    f.clean()

    if (expected === '1.0.0-alpha.0') {
      const head = f.git('rev-parse', 'HEAD')
      const repeated = f.run('version', 'demo', '--sync-versions', '--preid=alpha')

      assert.equal(repeated.status, 0, repeated.stderr)
      assert.match(repeated.stdout, /No releasable commits/)
      assert.equal(f.git('rev-parse', 'HEAD'), head)
      await f.write('packages/demo/index.js', 'fixed')
      f.commit('fix: Correct alpha API')
    }
  }
})

test('preid can be configured in project.json and previewed without release side effects', async t => {
  const f = await fixture(t)

  await f.write('packages/demo/project.json', {
    name: 'demo',
    targets: {
      version: {
        executor: 'semver:version',
        options: { preid: 'alpha' }
      }
    }
  })
  f.commit('feat: Prepare alpha')
  const head = f.git('rev-parse', 'HEAD')
  const result = f.run('version', 'demo', '--dry-run')

  assert.equal(result.status, 0, result.stderr + result.stdout)
  assert.match(result.stdout, /demo@1\.1\.0-alpha\.0/)
  assert.equal((await f.packageJson()).version, '1.0.0')
  assert.equal(f.git('rev-parse', 'HEAD'), head)
  assert.equal(f.git('tag', '--list'), '')
  f.clean()
})

test('invalid prerelease identifiers and channel downgrades fail before changing release files', async t => {
  const f = await fixture(t, '1.0.0-beta.0')

  for (const preid of [true, 1, '', ' ', 'alpha beta', 'alpha..preview', 'alpha/preview', 'alpha+build', '01', 'alpha.01']) {
    await assert.rejects(version({
      preid,
      releaseAs: 'patch'
    }, f.context), /Invalid semver:version options/)
  }

  f.git('tag', 'demo@1.0.0-beta.0')
  await assert.rejects(planRelease({
    preid: 'alpha',
    releaseAs: 'patch'
  }, f.context), /must be newer/)
  assert.equal((await f.packageJson()).version, '1.0.0-beta.0')
  assert.equal(f.git('tag', '--list'), 'demo@1.0.0-beta.0')
  f.clean()
})

test('publication tags handle dotted, numeric and latest prerelease identifiers', async t => {
  const f = await fixture(t)

  for (const [releaseAs, preid, npmTag] of [
    ['2.0.0-alpha.preview.2', 'alpha.preview', 'alpha.preview'],
    ['2.0.0-1.2', '1', 'next'],
    ['2.0.0-1', '1', 'next'],
    ['2.0.0-latest.0', 'latest', 'next'],
    ['2.0.0', '', 'latest'],
  ]) {
    const plan = await planRelease({ releaseAs }, f.context)

    assert.equal(plan.values.preid, preid)
    assert.equal(plan.values.npmTag, npmTag)
    assert.equal(plan.values.prerelease, preid !== '')
  }
})
