import assert from 'node:assert/strict'
import { mkdir, readFile, rename, rm, stat, symlink } from 'node:fs/promises'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'

import { test } from 'vitest'

import { fixture, parseCommits, planRelease, recommendedBump, releaseNotes, version } from './fixture.mjs'

for (const [message, expected] of [
  ['feat(api): Add search', 'minor'],
  ['fix: Repair search', 'patch'],
  ['feature: Add search', 'minor'],
  ['revert: Remove search', 'patch'],
  ['perf: Faster search', 'patch'],
  ['refactor!: Remove API', 'major'],
  ['feat(api)!: Replace API', 'major'],
  ['chore: Update settings\n\nBREAKING CHANGE: Rename setting', 'major'],
  ['fix: Update settings\n\nBREAKING-CHANGE: Rename setting', 'major'],
  ['docs: Explain API', undefined],
  ['Not a conventional commit', undefined],
]) {
  test(`conventional commit bump: ${message.split('\n')[0]}`, async () => {
    const commits = await parseCommits(`abcdef0\0${message}\n\0\n`)

    assert.equal(await recommendedBump(commits), expected)
  })
}

test('parses multiple bodies and renders preset changelog sections with multiline breaking notes', async () => {
  const commits = await parseCommits('abcdef01\0fix(api): <safe> *text*\n\nBody\n\0\n12345678\0feat(ui)!: New API\n\nBREAKING CHANGE: Replace <old> API\nUse the new endpoint instead.\n\0\n')
  const notes = await releaseNotes('2.0.0', commits, new Date('2026-01-02'))

  assert.equal(commits.length, 2)
  assert.equal(await recommendedBump(commits), 'major')
  assert.match(notes, /2\.0\.0 \(2026-01-02\)/)
  assert.match(notes, /BREAKING CHANGES/)
  assert.match(notes, /### Bug Fixes/)
  assert.ok(notes.includes('<safe> *text*'))
  assert.match(notes, /Replace <old> API\n\s+Use the new endpoint instead\./)
})

test('reverted changes do not bump versions or appear in notes', async t => {
  const f = await fixture(t)

  f.git('tag', 'demo@1.0.0')
  await f.write('packages/demo/feature.js', 'new feature')
  const feature = f.commit('feat!: Replace API')

  f.git('revert', '--no-edit', feature)
  const unchanged = await planRelease({}, f.context)

  assert.equal(unchanged.values, undefined)
  await f.write('packages/demo/fix.js', 'fix')
  f.commit('fix: Repair startup')
  const plan = await planRelease({}, f.context)

  assert.equal(plan.values.version, '1.0.1')
  assert.match(plan.values.notes, /Repair startup/)
  assert.doesNotMatch(plan.values.notes, /Replace API|Revert/)
})

test('reverting a previously released commit produces a patch release', async t => {
  const f = await fixture(t)

  await f.write('packages/demo/feature.js', 'new feature')
  const feature = f.commit('feat: Add search')

  f.git('tag', 'demo@1.0.0')
  f.git('revert', '--no-edit', feature)
  const plan = await planRelease({}, f.context)

  assert.equal(plan.values.version, '1.0.1')
  assert.match(plan.values.notes, /### Reverts/)
  assert.match(plan.values.notes, /Add search/)
})

test('CLI versions only project changes, commits two files, tags, and skips a repeated release', async t => {
  const f = await fixture(t)

  f.git('tag', 'demo@1.0.0')
  await f.write('packages/other/index.js', 'breaking other package')
  f.commit('feat(other)!: Replace unrelated API')
  await f.write('packages/demo/index.js', 'export const newFeature = true\n')
  const feature = f.commit('feat(demo): Add new feature')
  const result = f.run('version', 'demo')

  assert.equal(result.status, 0, result.stderr + result.stdout)
  assert.equal((await f.packageJson()).version, '1.1.0')
  assert.deepEqual((await f.packageJson()).dependencies, { external: '^1.0.0' })
  const notes = await readFile(join(f.context.projectRoot, 'CHANGELOG.md'), 'utf8')

  assert.match(notes, /### Features/)
  assert.match(notes, /Add new feature/)
  assert.ok(notes.includes(feature.slice(0, 7)))
  assert.doesNotMatch(notes, /unrelated/)
  assert.equal(f.git('log', '-1', '--format=%s'), 'chore(demo): Release 1.1.0')
  assert.deepEqual(f.git('diff-tree', '--no-commit-id', '--name-only', '-r', 'HEAD').split('\n'), ['packages/demo/CHANGELOG.md', 'packages/demo/package.json'])
  assert.equal(f.git('rev-parse', 'demo@1.1.0^{}'), f.git('rev-parse', 'HEAD'))
  const head = f.git('rev-parse', 'HEAD')

  f.clean()
  const repeated = f.run('run', 'demo:version')

  assert.equal(repeated.status, 0, repeated.stderr)
  assert.match(repeated.stdout, /No releasable commits/)
  assert.equal(f.git('rev-parse', 'HEAD'), head)
  await assert.rejects(stat(join(f.root, '.git/isox-release.lock')), { code: 'ENOENT' })
})

test('initial release uses the manifest version and preserves existing changelog entries', async t => {
  const f = await fixture(t, '0.3.2')

  await f.write('packages/demo/CHANGELOG.md', '# Changelog\n\n## 0.3.2\n\nEarlier notes.\n')
  f.commit('fix(demo): Correct startup')
  await version({}, f.context)
  assert.equal((await f.packageJson()).version, '0.3.3')
  const notes = await readFile(join(f.context.projectRoot, 'CHANGELOG.md'), 'utf8')

  assert.equal(notes.match(/# Changelog/g).length, 1)
  assert.match(notes, /0\.3\.3[\s\S]*Earlier notes/)
})

test('dry run validates and previews without any filesystem, tag, or hook effects', async t => {
  const f = await fixture(t)

  await f.write('packages/demo/index.js', 'new feature')
  f.commit('feat: New feature')
  f.context.project.targets.publish = {
    executor: 'core:run-command',
    options: { command: 'exit 99' }
  }
  const head = f.git('rev-parse', 'HEAD')
  const result = await version({
    dryRun: true,
    push: true,
    postTargets: ['publish']
  }, f.context)

  assert.equal(result.success, true)
  assert.equal((await f.packageJson()).version, '1.0.0')
  assert.equal(f.git('tag', '--list'), '')
  assert.equal(f.git('rev-parse', 'HEAD'), head)
  assert.ok(f.messages.some(message => message.includes('1.1.0')))
  await assert.rejects(stat(join(f.context.projectRoot, 'CHANGELOG.md')), { code: 'ENOENT' })
  await assert.rejects(stat(join(f.root, '.git/isox-release.lock')), { code: 'ENOENT' })
  f.clean()
})

test('only reachable project tags affect version selection', async t => {
  const f = await fixture(t)

  f.git('tag', 'demo@1.0.0')
  f.git('tag', 'other@99.0.0')
  f.git('tag', 'demo@not-a-version')
  f.git('checkout', '-b', 'future')
  await f.write('packages/demo/index.js', 'future')
  f.commit('feat!: Future major')
  f.git('tag', 'demo@10.0.0')
  f.git('checkout', 'main')
  await f.write('packages/demo/index.js', 'fix')
  f.commit('fix: Current fix')
  const plan = await planRelease({}, f.context)

  assert.equal(plan.values.previousTag, 'demo@1.0.0')
  assert.equal(plan.values.version, '1.0.1')
})

test('manual release accepts an initial version and explicit prereleases, and rejects downgrades', async t => {
  const f = await fixture(t)

  await version({
    releaseAs: '1.0.0',
    tagPrefix: 'v'
  }, f.context)
  assert.equal(f.git('tag', '--list'), 'v1.0.0')
  await version({
    releaseAs: '1.1.0-beta.1',
    tagPrefix: 'v'
  }, f.context)
  assert.equal((await f.packageJson()).version, '1.1.0-beta.1')
  await assert.rejects(version({
    releaseAs: '1.0.0',
    tagPrefix: 'v'
  }, f.context), /must be newer/)
  await assert.rejects(version({
    releaseAs: 'v2.0.0',
    tagPrefix: 'v'
  }, f.context), /exact semantic version/)
  f.clean()
})

for (const dirty of ['staged', 'unstaged', 'untracked']) {
  test(`refuses ${dirty} files without changing the index or release files`, async t => {
    const f = await fixture(t)

    if (dirty === 'untracked') {
      await f.write('unrelated.txt', 'user work')
    } else {
      await f.write('packages/demo/index.js', 'user work')
    }

    if (dirty === 'staged') {
      f.git('add', 'packages/demo/index.js')
    }

    const before = f.git('status', '--porcelain')

    await assert.rejects(version({ releaseAs: 'patch' }, f.context), /clean working tree/)
    assert.equal(f.git('status', '--porcelain'), before)
    assert.equal((await f.packageJson()).version, '1.0.0')
    assert.equal(f.git('tag', '--list'), '')
  })
}

test('refuses mismatched versions, invalid hooks, and concurrent releases before writes', async t => {
  const f = await fixture(t)

  f.git('tag', 'demo@0.9.0')
  await assert.rejects(version({ releaseAs: 'patch' }, f.context), /differs from latest/)
  f.git('tag', '-d', 'demo@0.9.0')
  await assert.rejects(version({
    releaseAs: 'patch',
    tagPrefix: '-'
  }, f.context), /must not start with a dash/)
  await assert.rejects(version({
    releaseAs: 'patch',
    tagPrefix: 'bad prefix'
  }, f.context), /check-ref-format failed/)
  await assert.rejects(version({
    releaseAs: 'patch',
    postTargets: ['missing']
  }, f.context), /Invalid release post target/)
  await assert.rejects(version({
    releaseAs: 'patch',
    postTargets: ['version']
  }, f.context), /cannot start another/)
  await f.write('.git/isox-release.lock', 'another process')
  await assert.rejects(version({ releaseAs: 'patch' }, f.context), /Another release/)
  assert.equal(await readFile(join(f.root, '.git/isox-release.lock'), 'utf8'), 'another process')
  assert.equal((await f.packageJson()).version, '1.0.0')
  f.clean()
})

test('rejects symlinked release files without writing through them', async t => {
  const f = await fixture(t)

  await f.write('notes.txt', 'Do not overwrite')
  await symlink(join(f.root, 'notes.txt'), join(f.context.projectRoot, 'CHANGELOG.md'))
  f.commit('chore: Link notes')
  await assert.rejects(version({ releaseAs: 'patch' }, f.context), /regular file/)
  assert.equal(await readFile(join(f.root, 'notes.txt'), 'utf8'), 'Do not overwrite')
})

test('pushes the release branch and only its tag atomically to an explicitly selected remote', async t => {
  const f = await fixture(t)
  const remote = join(f.root, '.isox/remote.git')

  await mkdir(remote, { recursive: true })
  f.git('init', '--bare', remote)
  f.git('remote', 'add', 'release-origin', remote)
  f.git('tag', 'unrelated')
  await version({
    releaseAs: 'patch',
    push: true,
    remote: 'release-origin'
  }, f.context)
  const refs = f.git('ls-remote', 'release-origin')

  assert.match(refs, /refs\/heads\/main/)
  assert.match(refs, /refs\/tags\/demo@1\.0\.1/)
  assert.doesNotMatch(refs, /unrelated/)
  f.clean()
})

test('push preflight failures do not write release files', async t => {
  const f = await fixture(t)

  await assert.rejects(version({
    releaseAs: 'patch',
    push: true
  }, f.context), /git remote failed/)
  f.git('checkout', '--detach')
  await assert.rejects(version({
    releaseAs: 'patch',
    push: true
  }, f.context), /symbolic-ref failed/)
  assert.equal((await f.packageJson()).version, '1.0.0')
  f.clean()
})

test('rejects malformed options and honors cancellation before touching Git', async t => {
  const f = await fixture(t)

  for (const options of [null, [], { unknown: true }, { dryRun: 'true' }, { postTargets: 'github' }, { postTargets: [{}] }]) {
    await assert.rejects(version(options, f.context), /Invalid semver:version options/)
  }

  await assert.rejects(version({}, {
    ...f.context,
    signal: AbortSignal.abort()
  }), { name: 'AbortError' })
  await rm(join(f.root, '.git'), { recursive: true })
  await assert.rejects(version({}, f.context), /git rev-parse failed/)
})

test('an existing tag on another branch is never overwritten', async t => {
  const f = await fixture(t)

  f.git('checkout', '-b', 'other-release')
  await f.write('packages/demo/index.js', 'other branch')
  f.commit('fix: Another change')
  f.git('tag', 'demo@1.0.1')
  const tagged = f.git('rev-parse', 'demo@1.0.1')

  f.git('checkout', 'main')
  await assert.rejects(version({ releaseAs: 'patch' }, f.context), /tag already exists/)
  assert.equal(f.git('rev-parse', 'demo@1.0.1'), tagged)
  assert.equal((await f.packageJson()).version, '1.0.0')
  f.clean()
})

test('shallow checkouts fail before changing release files', async t => {
  const f = await fixture(t)
  const clone = join(f.root, '.isox/shallow')

  await mkdir(join(f.root, '.isox'), { recursive: true })
  f.git('clone', '--depth=1', pathToFileURL(f.root).href, clone)
  await assert.rejects(version({ releaseAs: 'patch' }, {
    ...f.context,
    workspaceRoot: clone,
    projectRoot: join(clone, 'packages/demo')
  }), /full Git history/)
  assert.equal((await f.packageJson()).version, '1.0.0')
})

test('pathspec characters in project directories are treated literally', async t => {
  const f = await fixture(t)

  f.context.project.root = 'packages/[demo]'
  f.context.projectRoot = join(f.root, f.context.project.root)
  await rename(join(f.root, 'packages/demo'), f.context.projectRoot)
  f.commit('chore: Move project')
  f.git('tag', 'demo@1.0.0')
  await f.write('packages/[demo]/index.js', 'fix')
  f.commit('fix: Correct literal path')
  await version({}, f.context)
  assert.equal((await f.packageJson()).version, '1.0.1')
})
