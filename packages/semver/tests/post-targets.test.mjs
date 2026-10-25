import assert from 'node:assert/strict'
import { readFile, stat } from 'node:fs/promises'
import { join } from 'node:path'

import { test } from 'vitest'

import { fixture, version } from './fixture.mjs'

async function recorder(f) {
  await f.write('node_modules/recorder/package.json', {
    name: 'recorder',
    executors: './executors.json'
  })
  await f.write('node_modules/recorder/executors.json', { executors: { record: { implementation: './record.cjs' } } })
  await f.write('node_modules/recorder/record.cjs', `
    const fs = require('node:fs')
    const path = require('node:path')
    const cp = require('node:child_process')
    module.exports = (options, context) => {
      const directory = path.join(context.workspaceRoot, '.isox')
      fs.mkdirSync(directory, { recursive: true })
      const manifest = JSON.parse(fs.readFileSync(path.join(context.workspaceRoot, 'packages/demo/package.json')))
      const tagCommit = cp.execFileSync('git', ['rev-parse', options.tag + '^{}'], { cwd: context.workspaceRoot, encoding: 'utf8' }).trim()
      fs.appendFileSync(path.join(directory, 'calls.jsonl'), JSON.stringify({ options, project: context.projectName, version: manifest.version, tagCommit }) + '\\n')
      return { success: !options.fail }
    }
  `)
}

test('post targets run in order after tagging, with resolved options and typed release placeholders', async t => {
  const f = await fixture(t)

  await recorder(f)
  f.context.project.targets.publish = {
    executor: 'recorder:record',
    options: {
      tag: '{tag}',
      notes: '{notes}',
      dryRun: '{dryRun}',
      project: '{projectName}',
      nested: ['{version}', '{previousTag}']
    },
    defaultConfiguration: 'acc',
    configurations: { acc: { environment: 'acc' } }
  }
  f.context.workspace.projects.other = {
    name: 'other',
    root: '.',
    targets: {
      github: {
        executor: 'recorder:record',
        options: { tag: '{tag}' },
        configurations: { acc: { label: 'Release {version}' } }
      }
    }
  }
  const before = JSON.stringify(f.context.workspace)

  await version({
    releaseAs: 'minor',
    postTargets: [
      {
        target: 'publish',
        options: { extra: '{version}' }
      },
      'other:github:acc'
    ]
  }, f.context)
  const calls = (await readFile(join(f.root, '.isox/calls.jsonl'), 'utf8')).trim().split('\n').map(line => JSON.parse(line))

  assert.equal(calls.length, 2)
  assert.equal(calls[0].project, 'demo')
  assert.equal(calls[1].project, 'other')
  assert.equal(calls[0].version, '1.1.0')
  assert.equal(calls[0].tagCommit, f.git('rev-parse', 'HEAD'))
  assert.deepEqual(calls[0].options.nested, ['1.1.0', ''])
  assert.equal(calls[0].options.dryRun, false)
  assert.equal(calls[0].options.extra, '1.1.0')
  assert.equal(calls[0].options.environment, 'acc')
  assert.equal(calls[0].options.project, 'demo')
  assert.match(calls[0].options.notes, /## 1\.1\.0/)
  assert.equal(calls[1].options.label, 'Release 1.1.0')
  assert.equal(JSON.stringify(f.context.workspace), before)
  f.clean()
})

test('failed post target stops the sequence and keeps the existing release for recovery', async t => {
  const f = await fixture(t)

  await recorder(f)
  f.context.project.targets.publish = {
    executor: 'recorder:record',
    options: { tag: '{tag}' }
  }
  await assert.rejects(version({
    releaseAs: 'patch',
    postTargets: [
      {
        target: 'publish',
        options: { fail: true }
      }, 'publish'
    ]
  }, f.context), /was committed and tagged, but push or a post target failed/)
  assert.equal((await f.packageJson()).version, '1.0.1')
  assert.equal(f.git('rev-parse', 'demo@1.0.1^{}'), f.git('rev-parse', 'HEAD'))
  const calls = (await readFile(join(f.root, '.isox/calls.jsonl'), 'utf8')).trim().split('\n')

  assert.equal(calls.length, 1)
  await assert.rejects(stat(join(f.root, '.git/isox-release.lock')), { code: 'ENOENT' })
  f.clean()
})

test('synchronized skipCommit still runs post targets once with the new version and combined notes', async t => {
  const f = await fixture(t)

  await recorder(f)
  await f.write('packages/other/package.json', {
    name: 'other',
    version: '1.0.0'
  })
  f.context.workspace.projects.other = {
    name: 'other',
    root: 'packages/other'
  }
  f.commit('feat(other): New public API')
  f.context.project.targets.publish = {
    executor: 'recorder:record',
    options: {
      tag: '{tag}',
      notes: '{notes}'
    }
  }
  const head = f.git('rev-parse', 'HEAD')

  await version({
    syncVersions: true,
    skipCommit: true,
    skipProjectChangelog: true,
    postTargets: ['publish']
  }, f.context)
  const calls = (await readFile(join(f.root, '.isox/calls.jsonl'), 'utf8')).trim().split('\n').map(line => JSON.parse(line))

  assert.equal(calls.length, 1)
  assert.equal(calls[0].version, '1.1.0')
  assert.equal(calls[0].tagCommit, head)
  assert.equal(calls[0].options.tag, 'v1.1.0')
  assert.match(calls[0].options.notes, /New public API/)
  assert.equal(JSON.parse(await readFile(join(f.root, 'packages/other/package.json'), 'utf8')).version, '1.1.0')
  assert.equal(f.git('rev-parse', 'HEAD'), head)
  assert.deepEqual(f.git('diff', '--cached', '--name-only').split('\n'), ['CHANGELOG.md', 'packages/demo/package.json', 'packages/other/package.json'])
})

test('post targets receive publication metadata from the final version, including stable promotion', async t => {
  const f = await fixture(t)

  await recorder(f)
  f.context.project.targets.publish = {
    executor: 'recorder:record',
    options: {
      tag: '{tag}',
      preid: '{preid}',
      npmTag: '{npmTag}',
      prerelease: '{prerelease}',
      nested: ['channel={preid}', { tag: '{npmTag}' }]
    }
  }

  for (const releaseAs of ['minor', '1.1.0-beta.2', '1.1.0']) {
    await version({
      preid: 'alpha',
      releaseAs,
      postTargets: ['demo:publish']
    }, f.context)
  }

  const calls = (await readFile(join(f.root, '.isox/calls.jsonl'), 'utf8')).trim().split('\n').map(line => JSON.parse(line))

  assert.deepEqual(calls.map(call => [call.options.preid, call.options.npmTag, call.options.prerelease]), [
    ['alpha', 'alpha', true],
    ['beta', 'beta', true],
    ['', 'latest', false]
  ])
  assert.deepEqual(calls[0].options.nested, ['channel=alpha', { tag: 'alpha' }])
  assert.deepEqual(calls[2].options.nested, ['channel=', { tag: 'latest' }])
  f.clean()
})
