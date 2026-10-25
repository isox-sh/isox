import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { readFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'

import { test } from 'vitest'

import { planTargets } from '../../../actions/plan/index.mjs'
import { workerArgs } from '../../../actions/run-many/index.mjs'
import { latestBranchTag, resolvePlanRange } from '../../../actions/shared/git.mjs'
import { affectedFixture, cliPath } from './helpers/affected-fixture.mjs'

test('non-PR actions select the nearest reachable tag and ignore newer tags on other branches', async t => {
  const { root, git, write, commit, base } = await affectedFixture(t)
  const context = { cwd: root }

  git('-c', 'tag.gpgsign=false', 'tag', 'v1.0.0')
  await write('packages/lib/first.ts', 'first change')
  const tagged = commit()

  git('-c', 'tag.gpgsign=false', '-c', 'user.name=Isox test', '-c', 'user.email=test@example.invalid', 'tag', '-a', 'v1.1.0', '-m', 'release')
  await write('packages/lib/second.ts', 'second change')
  const head = commit()

  git('checkout', '-b', 'other', base)
  await write('packages/other/change.ts', 'unrelated')
  commit()
  git('-c', 'tag.gpgsign=false', 'tag', 'v99.0.0')
  git('checkout', 'main')

  assert.equal(latestBranchTag(context, head), 'v1.1.0')
  for (const eventName of ['push', 'workflow_dispatch', 'merge_group', 'schedule']) {
    assert.deepEqual(resolvePlanRange(context, {
      eventName,
      sha: head
    }), {
      base: tagged,
      head
    })
  }

  assert.deepEqual(resolvePlanRange(context, {
    eventName: 'push',
    event: { forced: true },
    sha: head
  }), {
    base: tagged,
    head
  })
  assert.deepEqual(resolvePlanRange(context, {
    base: 'v1.0.0',
    sha: head
  }), {
    base,
    head
  })
  assert.deepEqual(resolvePlanRange(context, {
    eventName: 'pull_request',
    event: { pull_request: { base: { sha: base } } },
    sha: head
  }), {
    base,
    head
  })
  assert.deepEqual(resolvePlanRange(context, {
    affectedOnly: false,
    base: 'missing'
  }), { head })
  assert.throws(() => resolvePlanRange(context, {
    base: 'missing',
    sha: head
  }), /fetch full history/)
  assert.throws(() => resolvePlanRange(context, { head: base }), /Check out the requested head/)
  assert.throws(() => resolvePlanRange(context, { eventName: 'pull_request' }), /missing its base SHA/)

  // Lightweight tags are eligible, including a release that points directly to HEAD.
  git('-c', 'tag.gpgsign=false', 'tag', 'v1.2.0')
  assert.equal(latestBranchTag(context, head), 'v1.2.0')
  assert.deepEqual(resolvePlanRange(context, { eventName: 'push' }), {
    base: head,
    head
  })
})

test('tag selection runs all without reachable tags but rejects incomplete history', async t => {
  const { root, git, write, commit, base } = await affectedFixture(t)

  assert.deepEqual(resolvePlanRange({ cwd: root }, { eventName: 'workflow_dispatch' }), {
    base: undefined,
    head: base
  })
  git('checkout', '-b', 'other')
  await write('packages/other/change.ts', 'unrelated')
  commit()
  git('-c', 'tag.gpgsign=false', 'tag', 'unreachable')
  git('checkout', 'main')
  assert.equal(latestBranchTag({ cwd: root }, base), undefined)

  const shallow = join(root, 'shallow')

  git('clone', '--depth=1', pathToFileURL(root).href, shallow)
  assert.throws(() => latestBranchTag({ cwd: shallow }, base), /fetch-depth: 0/)
})

test('action target options are explicit and reject typos and unsafe worker settings', () => {
  assert.deepEqual(planTargets('build\ndeploy', {
    build: { maxJobs: 3 },
    deploy: { tag: 'resource=web' }
  }), [
    {
      target: 'build',
      maxJobs: 3
    }, {
      target: 'deploy',
      tag: 'resource=web'
    },
  ])
  assert.throws(() => planTargets('build', { typo: {} }), /unrequested target typo/)
  assert.throws(() => planTargets('build', { build: { target: 'deploy' } }), /without a target/)
  assert.throws(() => workerArgs({
    target: 'build',
    projects: ['lib'],
    parallel: '2; echo oops'
  }), /parallel/)
  assert.throws(() => workerArgs({
    target: 'build',
    projects: ['lib', 'lib']
  }), /unique project names/)
  const unusual = 'project-$(touch-pwned)'

  assert.ok(workerArgs({
    target: 'build',
    projects: [unusual]
  }).includes(JSON.stringify([unusual])))
})

test('plan and run-many actions round trip exact weighted shards through GitHub output files', async t => {
  const { root, write, project, base, commit, git } = await affectedFixture(t)

  await project('lib', { plan: { weight: 4 } })
  const head = commit()

  await write('event.json', {
    pull_request: {
      base: { sha: base },
      head: { sha: head }
    }
  })
  const env = {
    ...process.env,
    GITHUB_WORKSPACE: root,
    GITHUB_EVENT_NAME: 'pull_request',
    GITHUB_EVENT_PATH: join(root, 'event.json'),
    GITHUB_SHA: head,
    GITHUB_OUTPUT: join(root, 'outputs'),
    GITHUB_STEP_SUMMARY: join(root, 'summary'),
    INPUT_CLIPATH: cliPath,
    INPUT_TARGETS: 'build',
    INPUT_TARGETOPTIONS: JSON.stringify({
      build: {
        maxJobs: 2,
        config: 'production',
        parallel: 2
      }
    }),
    INPUT_AFFECTEDONLY: 'true',
    INPUT_BASE: base,
    INPUT_HEAD: head,
  }
  const action = (name, extra = {}) => spawnSync(process.execPath, [resolve(import.meta.dirname, `../../../actions/${name}/index.mjs`)], {
    cwd: root,
    env: {
      ...env,
      ...extra
    },
    encoding: 'utf8'
  })
  const planned = action('plan')

  assert.equal(planned.status, 0, planned.stderr)
  const outputs = Object.fromEntries((await readFile(env.GITHUB_OUTPUT, 'utf8')).trim().split('\n').map(line => {
    const index = line.indexOf('=')

    return [line.slice(0, index), line.slice(index + 1)]
  }))

  assert.equal(outputs.hasPlan, 'true')
  const matrix = JSON.parse(outputs.matrix)

  assert.deepEqual(matrix.include.map(row => row.projects), [['lib'], ['app']])
  for (const row of matrix.include) {
    const result = action('run-many', { INPUT_PLAN: JSON.stringify(row) })

    assert.equal(result.status, 0, result.stderr)
  }

  const events = (await readFile(join(root, 'events.log'), 'utf8')).trim().split('\n').map(line => JSON.parse(line))

  assert.deepEqual(events.filter(event => event.phase === 'end').map(event => [event.project, event.marker]), [['lib', 'prod'], ['app', 'prod']])
  const mismatch = action('run-many', {
    INPUT_PLAN: JSON.stringify(matrix.include[0]),
    INPUT_HEAD: base
  })

  assert.equal(mismatch.status, 1)
  assert.match(mismatch.stderr, /does not match the plan head/)
  const empty = action('plan', { INPUT_BASE: head })

  assert.equal(empty.status, 0, empty.stderr)
  assert.match(await readFile(env.GITHUB_OUTPUT, 'utf8'), /matrix=\{"include":\[\]\}\nhasPlan=false/)
  git('-c', 'tag.gpgsign=false', 'tag', 'v1.0.0', base)
  const fromTag = action('plan', {
    INPUT_BASE: '',
    GITHUB_EVENT_NAME: 'workflow_dispatch'
  })

  assert.equal(fromTag.status, 0, fromTag.stderr)
  assert.deepEqual(JSON.parse(fromTag.stdout), matrix)
})

test('planner and worker preserve exact stage names and reject invalid stages through the same CLI contract', async t => {
  const { root, project } = await affectedFixture(t)
  const command = marker => ({
    executor: '@fixture/plugin:record',
    options: {
      marker,
      delay: 0
    },
    configurations: { acc: { marker: `${marker}-acc` } },
  })
  const decoy = {
    executor: '@fixture/plugin:record',
    options: {
      fail: true,
      delay: 0
    }
  }

  await project('lib', {
    tags: ['stage-names'],
    targets: {
      build: command('build'),
      'prepare,assets': command('prepare'),
      '--finish,assets': command('finish'),
      prepare: decoy,
      '--finish': decoy,
      assets: decoy,
    }
  })
  const settings = {
    tag: 'stage-names',
    config: 'acc',
    preTargets: ['prepare,assets:acc'],
    postTargets: ['--finish,assets']
  }
  const env = {
    ...process.env,
    GITHUB_WORKSPACE: root,
    GITHUB_OUTPUT: join(root, 'outputs'),
    GITHUB_STEP_SUMMARY: join(root, 'summary'),
    GITHUB_EVENT_PATH: '',
    INPUT_CLIPATH: cliPath,
    INPUT_TARGETS: 'build',
    INPUT_TARGETOPTIONS: JSON.stringify({ build: settings }),
    INPUT_AFFECTEDONLY: 'false',
    INPUT_HEAD: '',
  }
  const action = (name, extra = {}) => spawnSync(process.execPath, [resolve(import.meta.dirname, `../../../actions/${name}/index.mjs`)], {
    cwd: root,
    env: {
      ...env,
      ...extra
    },
    encoding: 'utf8'
  })
  const planned = action('plan')

  assert.equal(planned.status, 0, planned.stderr)
  const [row] = JSON.parse(planned.stdout).include

  assert.deepEqual(row.preTargets, settings.preTargets)
  assert.deepEqual(row.postTargets, settings.postTargets)
  const completed = action('run-many', { INPUT_PLAN: JSON.stringify(row) })

  assert.equal(completed.status, 0, completed.stderr)
  const recorded = await readFile(join(root, 'events.log'), 'utf8')
  const events = recorded.trim().split('\n').map(line => JSON.parse(line))

  assert.deepEqual(events.filter(event => event.phase === 'end').map(event => [event.target, event.marker]), [
    ['prepare,assets', 'prepare-acc'], ['build', 'build-acc'], ['--finish,assets', 'finish'],
  ])

  for (const field of ['preTargets', 'postTargets']) {
    for (const stages of [['prepare:acc:extra'], ['prepare:acc,prod'], [1], null]) {
      const rejectedPlan = action('plan', {
        INPUT_TARGETOPTIONS: JSON.stringify({
          build: {
            ...settings,
            [field]: stages
          }
        })
      })
      const rejectedWorker = action('run-many', {
        INPUT_PLAN: JSON.stringify({
          ...row,
          [field]: stages
        })
      })

      assert.equal(rejectedPlan.status, 1, rejectedPlan.stderr)
      assert.equal(rejectedWorker.status, 1, rejectedWorker.stderr)
    }
  }

  assert.equal(await readFile(join(root, 'events.log'), 'utf8'), recorded)
})

test('JSON targets preserve commas in command names', () => {
  assert.deepEqual(planTargets('["prepare,assets","build"]', { 'prepare,assets': { maxJobs: 2 } }), [
    {
      target: 'prepare,assets',
      maxJobs: 2
    }, { target: 'build' },
  ])
  for (const value of ['[]', '[null]', '["bad target"]', '["bad:target"]']) {
    assert.throws(() => planTargets(value, {}))
  }
})
