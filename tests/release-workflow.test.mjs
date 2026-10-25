import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'

import { test } from 'vitest'

import { fixture } from '../packages/semver/tests/fixture.mjs'

const configuration = JSON.parse(await readFile(new URL('../project.json', import.meta.url), 'utf8'))

async function workspace(t, { changed = true, fail = false } = {}) {
  const f = await fixture(t)
  const project = structuredClone(configuration)

  // Exercise the repository's real post-target order and exact-tag push without publishing externally.
  for (const name of ['npm', 'github']) {
    project.targets[name].executor = 'recorder:record'
    project.targets[name].options.step = name
    project.targets[name].options.fail = name === 'npm' && fail
  }

  await f.write('node_modules/recorder/package.json', { executors: './executors.json' })
  await f.write('node_modules/recorder/executors.json', { executors: { record: { implementation: './record.cjs' } } })
  await f.write('node_modules/recorder/record.cjs', `
    const fs = require('node:fs')
    const path = require('node:path')
    const cp = require('node:child_process')
    module.exports = (options, context) => {
      const remoteTags = cp.execFileSync('git', ['ls-remote', '--tags', 'origin'], { cwd: context.workspaceRoot, encoding: 'utf8' })
      fs.appendFileSync(path.join(context.workspaceRoot, '.isox/calls.jsonl'), JSON.stringify({ options, remoteTags }) + '\\n')
      return { success: !options.fail }
    }
  `)
  await f.write('project.json', project)
  await f.write('package.json', {
    name: 'workspace',
    version: '1.0.0',
    private: true
  })
  f.commit('chore: Configure releases')
  f.git('tag', 'v1.0.0')
  f.git('init', '--bare', '.isox/remote.git')
  f.git('remote', 'add', 'origin', join(f.root, '.isox/remote.git'))
  f.git('push', 'origin', 'HEAD:refs/heads/main', 'refs/tags/v1.0.0:refs/tags/v1.0.0')
  f.git('tag', '-a', 'unrelated-tag', '-m', 'Do not push')

  if (changed) {
    await f.write('packages/demo/index.js', 'export const added = true\n')
    f.commit('feat: Add functionality')
  }

  return f
}

for (const channel of ['stable', 'alpha', 'beta']) {
  test(`${channel} post targets publish npm before pushing only the release tag and creating a GitHub release`, async t => {
    const f = await workspace(t)
    const head = f.git('rev-parse', 'HEAD')
    const result = f.run('version', 'workspace', '--config=production', ...(channel === 'stable' ? [] : [`--preid=${channel}`]))

    assert.equal(result.status, 0, result.stderr)
    const calls = (await readFile(join(f.root, '.isox/calls.jsonl'), 'utf8')).trim().split('\n').map(JSON.parse)
    const version = channel === 'stable' ? '1.1.0' : `1.1.0-${channel}.0`
    const tag = `v${version}`

    assert.deepEqual(calls.map(call => call.options.step), ['npm', 'github'])
    assert.equal(calls[0].options.command, `node scripts/release.mjs --version=${version} --tag=${channel === 'stable' ? 'latest' : channel}`)
    assert.ok(!calls[0].remoteTags.includes(`refs/tags/${tag}`))
    assert.ok(calls[1].remoteTags.includes(`refs/tags/${tag}`))
    assert.ok(!calls[1].remoteTags.includes('unrelated-tag'))
    assert.equal(calls[1].options.tag, tag)
    assert.equal(calls[1].options.prerelease, channel !== 'stable')
    assert.match(calls[1].options.notes, /Add functionality/)
    assert.equal(f.git('rev-parse', 'HEAD'), head)
    assert.ok(!f.git('ls-remote', 'origin', 'refs/heads/main').startsWith(head))
  })
}

for (const dryRun of [false, true]) {
  test(dryRun ? 'dry runs skip all release post targets' : 'no releasable changes skip all release post targets', async t => {
    const f = await workspace(t, { changed: dryRun })
    const before = f.git('tag', '--list')
    const result = f.run('version', 'workspace', '--config=production', '--options', JSON.stringify({ dryRun }))

    assert.equal(result.status, 0, result.stderr)
    f.clean()
    assert.equal(f.git('tag', '--list'), before)
    await assert.rejects(readFile(join(f.root, '.isox/calls.jsonl')), { code: 'ENOENT' })
  })
}

test('failed npm publication stops tag pushing and GitHub release creation', async t => {
  const f = await workspace(t, { fail: true })
  const result = f.run('version', 'workspace', '--config=production')

  assert.equal(result.status, 1)
  const calls = (await readFile(join(f.root, '.isox/calls.jsonl'), 'utf8')).trim().split('\n').map(JSON.parse)

  assert.deepEqual(calls.map(call => call.options.step), ['npm'])
  assert.equal(f.git('ls-remote', 'origin', 'refs/tags/v1.1.0'), '')
})
