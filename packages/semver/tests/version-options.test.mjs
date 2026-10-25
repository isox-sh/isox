import assert from 'node:assert/strict'
import { mkdir, readFile, stat, symlink } from 'node:fs/promises'
import { join } from 'node:path'

import { test } from 'vitest'

import { fixture, planRelease, version } from './fixture.mjs'

async function syncedFixture(t) {
  const f = await fixture(t)

  await f.write('package.json', {
    name: 'workspace',
    version: '1.0.0',
    private: true
  })
  await f.write('packages/other/package.json', {
    name: 'other',
    version: '1.0.0'
  })
  await f.write('packages/other/project.json', { name: 'other' })
  await f.write('packages/other/index.js', 'initial')
  f.context.workspace.projects.other = {
    name: 'other',
    root: 'packages/other'
  }
  f.commit('chore: Set up workspace')
  f.git('tag', 'v1.0.0')

  return f
}

async function manifest(f, path) {
  return JSON.parse(await readFile(join(f.root, path, 'package.json'), 'utf8'))
}

test('syncVersions makes one release for every versioned package, including unchanged packages and root', async t => {
  const f = await syncedFixture(t)

  await f.write('packages/other/index.js', 'feature')
  f.commit('feat(other): New feature')
  await version({
    syncVersions: true,
    commitMessageFormat: 'release: {projectName} {version} [skip ci]'
  }, f.context)

  for (const path of ['.', 'packages/demo', 'packages/other']) {
    assert.equal((await manifest(f, path)).version, '1.1.0')
    assert.match(await readFile(join(f.root, path, 'CHANGELOG.md'), 'utf8'), /## 1\.1\.0/)
  }

  assert.match(await readFile(join(f.root, 'CHANGELOG.md'), 'utf8'), /New feature/)
  assert.match(await readFile(join(f.root, 'packages/other/CHANGELOG.md'), 'utf8'), /New feature/)
  assert.doesNotMatch(await readFile(join(f.root, 'packages/demo/CHANGELOG.md'), 'utf8'), /New feature/)
  assert.equal(f.git('log', '-1', '--format=%s'), 'release: demo 1.1.0 [skip ci]')
  assert.equal(f.git('rev-parse', 'v1.1.0^{}'), f.git('rev-parse', 'HEAD'))
  const head = f.git('rev-parse', 'HEAD')

  await version({ syncVersions: true }, f.context)
  assert.equal(f.git('rev-parse', 'HEAD'), head)
  f.clean()
})

test('syncVersions includes workspace changes outside project directories and honors a custom shared tag prefix', async t => {
  const f = await syncedFixture(t)

  f.git('tag', 'all-1.0.0')
  await f.write('shared-settings.json', { changed: true })
  f.commit('fix: Correct shared settings')
  await version({
    syncVersions: true,
    tagPrefix: 'all-'
  }, f.context)
  assert.equal((await f.packageJson()).version, '1.0.1')
  assert.equal((await manifest(f, 'packages/other')).version, '1.0.1')
  assert.equal(f.git('rev-parse', 'all-1.0.1^{}'), f.git('rev-parse', 'HEAD'))
})

test('initial sync uses the highest version and skips projects and root manifests without versions', async t => {
  const f = await fixture(t, '0.2.0')

  await f.write('package.json', {
    name: 'workspace',
    private: true
  })
  await f.write('packages/other/package.json', {
    name: 'other',
    version: '2.0.0'
  })
  await f.write('apps/web/package.json', {
    name: 'web',
    private: true
  })
  await f.write('apps/no-package/project.json', { name: 'no-package' })
  Object.assign(f.context.workspace.projects, {
    other: {
      name: 'other',
      root: 'packages/other'
    },
    web: {
      name: 'web',
      root: 'apps/web'
    },
    noPackage: {
      name: 'no-package',
      root: 'apps/no-package'
    }
  })
  f.commit('feat: Initial workspace')
  await version({ syncVersions: true }, f.context)
  assert.equal((await f.packageJson()).version, '2.1.0')
  assert.equal((await manifest(f, 'packages/other')).version, '2.1.0')
  assert.equal((await manifest(f, '.')).version, undefined)
  assert.equal((await manifest(f, 'apps/web')).version, undefined)
  assert.match(await readFile(join(f.root, 'CHANGELOG.md'), 'utf8'), /## 2\.1\.0/)
  await assert.rejects(stat(join(f.root, 'apps/web/CHANGELOG.md')), { code: 'ENOENT' })
  f.clean()
})

test('sync validates every manifest and changelog before writing any package', async t => {
  const f = await syncedFixture(t)

  await f.write('packages/other/package.json', {
    name: 'other',
    version: '0.9.0'
  })
  f.commit('fix: Mismatched manifest')
  await assert.rejects(version({ syncVersions: true }, f.context), /differs from latest/)
  assert.equal((await f.packageJson()).version, '1.0.0')
  await f.write('packages/other/package.json', {
    name: 'other',
    version: 'invalid'
  })
  f.commit('fix: Invalid manifest')
  await assert.rejects(version({ syncVersions: true }, f.context), /valid semantic version/)
  await f.write('packages/other/package.json', {
    name: 'other',
    version: '1.0.0'
  })
  await symlink(join(f.root, 'package.json'), join(f.root, 'packages/other/CHANGELOG.md'))
  f.commit('fix: Linked notes')
  await assert.rejects(version({ syncVersions: true }, f.context), /regular file/)
  assert.equal((await f.packageJson()).version, '1.0.0')
  f.clean()
})

test('skipProjectChangelog leaves existing project logs untouched but writes root notes during sync', async t => {
  const f = await syncedFixture(t)

  await f.write('packages/demo/CHANGELOG.md', 'Existing notes\n')
  f.commit('fix: Correct behavior')
  await version({
    syncVersions: true,
    skipProjectChangelog: true
  }, f.context)
  assert.equal(await readFile(join(f.root, 'packages/demo/CHANGELOG.md'), 'utf8'), 'Existing notes\n')
  await assert.rejects(stat(join(f.root, 'packages/other/CHANGELOG.md')), { code: 'ENOENT' })
  assert.match(await readFile(join(f.root, 'CHANGELOG.md'), 'utf8'), /Correct behavior/)
  assert.equal((await manifest(f, 'packages/other')).version, '1.0.1')
  f.clean()
})

test('independent skipProjectChangelog skips all log files and supports an unchanged explicit initial version', async t => {
  const f = await fixture(t)

  await f.write('packages/demo/CHANGELOG.md', 'Existing notes\n')
  f.commit('chore: Initial notes')
  const head = f.git('rev-parse', 'HEAD')
  const result = f.run('version', 'demo', '--skip-project-changelog', '--release-as=1.0.0')

  assert.equal(result.status, 0, result.stderr + result.stdout)
  assert.notEqual(f.git('rev-parse', 'HEAD'), head)
  assert.equal(f.git('rev-parse', 'demo@1.0.0^{}'), f.git('rev-parse', 'HEAD'))
  assert.equal(await readFile(join(f.root, 'packages/demo/CHANGELOG.md'), 'utf8'), 'Existing notes\n')
  await assert.rejects(stat(join(f.root, 'CHANGELOG.md')), { code: 'ENOENT' })
  f.clean()
})

test('skipCommit stages files, tags existing HEAD, and can push that tag without publishing generated files', async t => {
  const f = await fixture(t)
  const remote = join(f.root, '.isox/remote.git')

  await mkdir(remote, { recursive: true })
  f.git('init', '--bare', remote)
  f.git('remote', 'add', 'origin', remote)
  const head = f.git('rev-parse', 'HEAD')

  await version({
    skipCommit: true,
    releaseAs: 'minor',
    push: true,
    commitMessageFormat: 'Ignored message'
  }, f.context)
  assert.equal(f.git('rev-parse', 'HEAD'), head)
  assert.equal(f.git('rev-parse', 'demo@1.1.0^{}'), head)
  assert.equal((await f.packageJson()).version, '1.1.0')
  assert.deepEqual(f.git('diff', '--cached', '--name-only').split('\n'), ['packages/demo/CHANGELOG.md', 'packages/demo/package.json'])
  assert.equal(f.git('diff', '--name-only'), '')
  assert.equal(JSON.parse(f.git('--git-dir', remote, 'show', 'demo@1.1.0:packages/demo/package.json')).version, '1.0.0')
})

test('all four options compose in dry runs without creating files, commits, or tags', async t => {
  const f = await syncedFixture(t)
  const before = f.git('rev-parse', 'HEAD')
  const result = f.run('version', 'demo', '--sync-versions', '--skip-commit', '--skip-project-changelog', '--release-as=minor', '--commit-message-format=Release {version}', '--dry-run')

  assert.equal(result.status, 0, result.stderr + result.stdout)
  assert.match(result.stdout, /v1\.1\.0/)
  assert.match(result.stdout, /stage files and tag existing HEAD/)
  assert.equal((await f.packageJson()).version, '1.0.0')
  assert.equal(f.git('rev-parse', 'HEAD'), before)
  assert.equal(f.git('tag', '--list'), 'v1.0.0')
  await assert.rejects(stat(join(f.root, 'CHANGELOG.md')), { code: 'ENOENT' })
  f.clean()
})

test('custom commit messages preserve literal shell characters and multiline text', async t => {
  const f = await fixture(t)
  const message = 'release({projectName}): {version}\n\nLiteral $(touch never) `touch never`'

  await version({
    releaseAs: 'patch',
    commitMessageFormat: message
  }, f.context)
  assert.equal(f.git('log', '-1', '--format=%B'), message.replace('{projectName}', 'demo').replace('{version}', '1.0.1'))
  await assert.rejects(stat(join(f.root, 'never')), { code: 'ENOENT' })
})

test('root project sync writes one root changelog and post-target notes remain available when logs are skipped', async t => {
  const f = await syncedFixture(t)
  const context = {
    ...f.context,
    projectName: 'workspace',
    projectRoot: f.root,
    project: {
      name: 'workspace',
      root: '.'
    }
  }

  context.workspace.projects.workspace = context.project
  const plan = await planRelease({
    syncVersions: true,
    releaseAs: 'patch'
  }, context)

  assert.equal(plan.projects.length, 3)
  assert.equal(plan.changelogs.filter(entry => entry.root === f.root).length, 1)
  const independent = await planRelease({
    skipProjectChangelog: true,
    releaseAs: 'minor'
  }, f.context)

  assert.equal(independent.changelogs.length, 0)
  assert.match(independent.values.notes, /## 1\.1\.0/)
})

test('new options reject invalid types and empty commit messages', async t => {
  const f = await fixture(t)

  for (const options of [{ skipCommit: 'true' }, { syncVersions: 1 }, { skipProjectChangelog: null }, { commitMessageFormat: true }, { commitMessageFormat: '' }, { commitMessageFormat: ' \n ' }]) {
    await assert.rejects(version(options, f.context), /Invalid semver:version options/)
  }

  f.clean()
})
