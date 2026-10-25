import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { readFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { setTimeout as delay } from 'node:timers/promises'

import { test } from 'vitest'

import { affectedFixture, cliPath } from './helpers/affected-fixture.mjs'

const events = async root => (await readFile(join(root, 'events.log'), 'utf8')).trim().split('\n').map(line => JSON.parse(line))

test('affected prints clean JSON with verbose logs on stderr, includes dependents, and runs from nested folders', async t => {
  const { root, write, commit, run } = await affectedFixture(t)

  await write('packages/lib/changed.ts', 'change')
  commit()
  const output = run('affected', '--target=build', '--print-matrix', '--verbose')

  assert.equal(output.status, 0, output.stderr)
  assert.deepEqual(JSON.parse(output.stdout), ['app', 'lib'])
  assert.match(output.stderr, /Affected comparison/)
  const child = spawn(process.execPath, [cliPath, 'affected', '--target=build', '--print-matrix'], { cwd: join(root, 'packages/app') })
  let stdout = ''

  child.stdout.on('data', data => {
    stdout += data
  })
  assert.equal(await new Promise(resolve => child.on('close', resolve)), 0)
  assert.deepEqual(JSON.parse(stdout), ['app', 'lib'])
})

test('affected defaults to committed changes, supports local opt-ins and empty matrices', async t => {
  const { write, run } = await affectedFixture(t)

  await write('packages/lib/new.ts', 'untracked')
  assert.deepEqual(JSON.parse(run('affected', '--target=build', '--print-matrix').stdout), [])
  assert.deepEqual(JSON.parse(run('affected', '--target=build', '--untracked', '--print-matrix').stdout), ['app', 'lib'])
  assert.deepEqual(JSON.parse(run('plan', '--target=build').stdout), { include: [] })
})

test('affected and plan ignore unowned files and configured exclusions from local changes', async t => {
  const { write, git, commit, run } = await affectedFixture(t)

  await write('isox.json', { affected: { ignoreFiles: ['**/*.md', 'pnpm-lock.yaml'] } })
  const base = commit()

  await write('NEXT_ON.md', 'notes')
  git('add', 'NEXT_ON.md')
  await write('notes.txt', 'untracked root file')
  await write('packages/lib/README.md', 'ignored project file')
  await write('pnpm-lock.yaml', 'ignored global file')
  const args = ['--target=build', `--base=${base}`, '--uncommitted', '--untracked']
  const affected = () => {
    const result = run('affected', ...args, '--print-matrix')

    assert.equal(result.status, 0, result.stderr)

    return JSON.parse(result.stdout)
  }

  assert.deepEqual(affected(), [])
  await write('packages/lib/change.ts', 'export const value = 1')
  assert.deepEqual(affected(), ['app', 'lib'])
  const plan = run('plan', ...args)

  assert.equal(plan.status, 0, plan.stderr)
  assert.deepEqual(JSON.parse(plan.stdout).include.flatMap(row => row.projects).sort(), ['app', 'lib'])
})

test('affected validates ignoreFiles patterns in workspace settings', async t => {
  const { write, run } = await affectedFixture(t)

  for (const ignoreFiles of ['*.md', [1], [''], ['*.md', '*.md']]) {
    await write('isox.json', { affected: { ignoreFiles } })
    const result = run('affected', '--target=build', '--print-matrix')

    assert.equal(result.status, 1)
    assert.match(result.stderr, /Invalid workspace configuration/)
    assert.equal(result.stdout, '')
  }
})

test('plans bypass stale discovery data and apply changed weights without reset', async t => {
  const { project, run } = await affectedFixture(t)
  const original = run('plan', '--target=build', '--all', '--max-jobs=2')

  assert.equal(original.status, 0, original.stderr)
  await project('other', { plan: { weight: 8 } })
  await project('new', { plan: { weight: 2 } })
  const next = run('plan', '--target=build', '--all', '--max-jobs=2')

  assert.equal(next.status, 0, next.stderr)
  assert.deepEqual(JSON.parse(next.stdout).include.map(row => [row.projects, row.weight]), [
    [['other'], 8], [['app', 'lib', 'new'], 4],
  ])
})

test('numeric-looking Git refs, names, tags and configurations retain their exact spelling', async t => {
  const { root, project, git, commit, run } = await affectedFixture(t)

  git('-c', 'tag.gpgsign=false', 'tag', '2026')
  const command = {
    executor: '@fixture/plugin:record',
    defaultConfiguration: '001',
    configurations: {
      '001': {
        marker: 'leading-zero',
        delay: 0
      }
    },
  }

  await project('007', {
    tags: ['007'],
    targets: {
      '01': command,
      '02': command,
      '03': command
    }
  })
  commit()

  const planned = run('plan', '-t=01', '--base=2026', '--tag=007', '-c=001')

  assert.equal(planned.status, 0, planned.stderr)
  const [row] = JSON.parse(planned.stdout).include

  assert.deepEqual([row.target, row.projects, row.config], ['01', ['007'], '001'])
  const empty = run('affected', '--target=01', '--base=2026', '--head=2026', '--print-matrix')

  assert.equal(empty.status, 0, empty.stderr)
  assert.deepEqual(JSON.parse(empty.stdout), [])

  const executed = run('run-many', '--target=01', '--projects=007', '--config=001', '--pre-targets=02', '--post-targets=03')

  assert.equal(executed.status, 0, executed.stderr)
  assert.deepEqual((await events(root)).filter(event => event.phase === 'end').map(event => [event.project, event.target, event.config]), [
    ['007', '02', '001'], ['007', '01', '001'], ['007', '03', '001'],
  ])
})

test('multi-target plans validate configuration, duplicate targets, settings and matrix limits', async t => {
  const { run } = await affectedFixture(t)
  const output = run('plan', '--all', '--targets-json', JSON.stringify([
    {
      target: 'build',
      maxJobs: 2,
      config: 'production',
      preTargets: ['prepare:production']
    },
    { target: 'finish' },
  ]))

  assert.equal(output.status, 0, output.stderr)
  assert.equal(JSON.parse(output.stdout).include.length, 3)
  for (const args of [
    ['--targets-json', '[{"target":"build","maxJob":3}]'],
    ['--targets-json', '[{"target":"build"},{"target":"build"}]'],
    ['--targets-json', '[{"target":"build","parallel":"2"}]'],
    ['--targets-json', '[{"target":"build","preTargets":["prepare:acc:extra"]}]'],
    ['--targets-json', '[{"target":"build","postTargets":["finish:acc,prod"]}]'],
    ['--targets-json', 'invalid'],
    ['--targets-json', '[{"target":"build"}]', '--target=build'],
    ['--targets-json', '[{"target":"build"}]', '--pre-targets-json', '[]'],
    ['--targets-json', '[{"target":"build"}]', '--post-targets-json', '[]'],
    ['--target=build', '--config=missing'],
    ['--target=build', '--max-jobs=0'],
    ['--target=build', '--parallel=1.5'],
    ['--target=build', '--base=HEAD'],
  ]) {
    const result = run('plan', '--all', ...args)

    assert.equal(result.status, 1, JSON.stringify(args))
    assert.equal(result.stdout, '')
  }
})

test('run-many isolates projects, bounds concurrency and puts barriers around configured pre/post stages', async t => {
  const { root, run } = await affectedFixture(t)
  const result = run('run-many', '--target=build', '--projects-json', '["lib","app","other"]', '--parallel=2', '--prod', '--pre-targets=prepare:production', '--post-targets=finish')

  assert.equal(result.status, 0, result.stderr)
  const log = await events(root)
  let running = 0
  let peak = 0

  for (const event of log) {
    running += event.phase === 'start' ? 1 : -1
    peak = Math.max(peak, running)
  }

  assert.equal(running, 0)
  assert.equal(peak, 2)
  assert.equal(log.length, 18)
  assert.ok(log.slice(0, 6).every(event => event.target === 'prepare' && event.marker === 'prod'))
  assert.ok(log.slice(6, 12).every(event => event.target === 'build' && event.marker === 'prod'))
  assert.ok(log.slice(12).every(event => event.target === 'finish' && event.marker === 'base'))
})

test('affected executes the selected projects and no unrelated projects', async t => {
  const { root, write, commit, run } = await affectedFixture(t)

  await write('packages/lib/change', 'change')
  commit()
  const result = run('affected', '--target=build', '--parallel=2')

  assert.equal(result.status, 0, result.stderr)
  assert.deepEqual([...new Set((await events(root)).map(event => event.project))].sort(), ['app', 'lib'])
})

test('run-many fails before executing invalid exact plans and treats an empty list as no work', async t => {
  const { root, run } = await affectedFixture(t)

  for (const args of [
    ['--projects-json', '["lib","missing"]'],
    ['--projects-json', '["lib","lib"]'],
    ['--projects-json', '["lib"]', '--tag=ci'],
    ['--projects-json', '["lib"]', '--projects=app'],
    ['--projects-json', '["lib"]', '--config=missing'],
    ['--projects-json', '["lib"]', '--parallel=0'],
    ['--projects-json', '["lib"]', '--pre-targets-json', '[1]'],
    ['--projects-json', '["lib"]', '--post-targets-json', 'null'],
    ['--projects-json', '["lib"]', '--pre-targets-json', '["prepare:acc:extra"]'],
    ['--projects-json', '["lib"]', '--pre-targets=prepare', '--pre-targets-json', '[]'],
    ['--projects-json', '["lib"]', '--post-targets=finish', '--post-targets-json', '[]'],
  ]) {
    assert.equal(run('run-many', '--target=build', ...args).status, 1)
  }

  assert.equal(run('run-many', '--target=build', '--projects-json', '[]').status, 0)
  await assert.rejects(readFile(join(root, 'events.log')), { code: 'ENOENT' })
})

test('worker failures stop pending projects and post stages', async t => {
  const { root, project, run } = await affectedFixture(t)

  await project('lib', {
    targets: {
      build: {
        executor: '@fixture/plugin:record',
        options: { fail: true }
      }
    }
  })
  const result = run('run-many', '--target=build', '--projects-json', '["lib","app"]', '--parallel=1', '--post-targets=finish')

  assert.equal(result.status, 1)
  assert.deepEqual((await events(root)).map(event => event.project), ['lib', 'lib'])
})

test('workers pass unusual project names literally, including leading option characters', async t => {
  const { root, project, run } = await affectedFixture(t)
  const name = '--option-$(literal)'

  await project(name)
  const result = run('run-many', '--target=build', '--projects-json', JSON.stringify([name]))

  assert.equal(result.status, 0, result.stderr)
  assert.deepEqual((await events(root)).map(event => event.project), [name, name])
})

test('shared tooling glob changes select all projects', async t => {
  const { write, commit, run } = await affectedFixture(t)

  await write('isox.json', { affected: { globalFiles: ['packages/lib/**'] } })
  const base = commit()

  await write('packages/lib/tool.ts', 'change')
  commit()
  const result = run('affected', '--target=build', `--base=${base}`, '--print-matrix')

  assert.equal(result.status, 0, result.stderr)
  assert.deepEqual(JSON.parse(result.stdout), ['app', 'lib', 'other'])
})

test('worker cancellation propagates to children and exits with the signal status', async t => {
  const { root, project } = await affectedFixture(t)

  await project('lib', {
    targets: {
      build: {
        executor: '@fixture/plugin:record',
        options: { delay: 60_000 }
      }
    }
  })
  const child = spawn(process.execPath, [cliPath, 'run-many', '--target=build', '--projects-json', '["lib"]'], {
    cwd: root,
    stdio: 'ignore'
  })

  t.onTestFinished(() => child.kill('SIGKILL'))
  const closed = new Promise(resolve => child.on('close', (code, signal) => resolve({
    code,
    signal
  })))

  for (let attempt = 0; attempt < 100; attempt++) {
    try {
      if ((await events(root)).length) {
        break
      }
    } catch {
      // Wait until the child has entered the executor before sending the signal.
    }

    await delay(20)
  }

  assert.equal((await events(root)).length, 1)
  child.kill('SIGTERM')
  assert.deepEqual(await closed, {
    code: 143,
    signal: null
  })
  assert.equal((await events(root)).length, 1)
})

for (const [signal, code] of [['SIGINT', 130], ['SIGTERM', 143]]) {
  test.skipIf(process.platform === 'win32')(`abort-aware executors keep the ${signal} exit status without logging a task error`, async t => {
    const { root, write } = await affectedFixture(t)

    await write('node_modules/@fixture/plugin/record.cjs', `
      module.exports = async (_, context) => {
        require('node:fs').writeFileSync('ready', 'yes')
        await require('node:timers/promises').setTimeout(60_000, undefined, { signal: context.signal })
        return { success: true }
      }
    `)
    const child = spawn(process.execPath, [cliPath, 'build', 'lib'], {
      cwd: root,
      stdio: ['ignore', 'pipe', 'pipe']
    })

    t.onTestFinished(() => child.kill('SIGKILL'))
    let stderr = ''

    child.stderr.on('data', chunk => {
      stderr += chunk
    })
    const closed = new Promise(resolve => child.once('close', (code, signal) => resolve({
      code,
      signal
    })))
    let ready = false

    for (let attempt = 0; attempt < 100 && !ready; attempt++) {
      try {
        ready = await readFile(join(root, 'ready'), 'utf8') === 'yes'
      } catch (error) {
        if (error.code !== 'ENOENT') {
          throw error
        }

        await delay(20)
      }
    }

    assert.ok(ready, 'executor did not start')
    child.kill(signal)
    assert.deepEqual(await closed, {
      code,
      signal: null
    })
    assert.doesNotMatch(stderr, /ERROR|Successfully completed/)
  })
}

test.skipIf(process.platform === 'win32')('worker cancellation lets executors kill stubborn subprocesses before stopping the worker', async t => {
  const { root, write } = await affectedFixture(t)
  const core = resolve(import.meta.dirname, '../../../dist/core')

  await write('node_modules/@fixture/plugin/record.cjs', `
    const { runProcess } = require(${JSON.stringify(core)})
    module.exports = (_, context) => runProcess(process.execPath, ['stubborn.cjs'], {
      cwd: context.workspaceRoot, signal: context.signal,
    })
  `)
  await write('stubborn.cjs', `
    process.on('SIGTERM', () => {})
    require('node:fs').writeFileSync('ready', String(process.pid))
    setInterval(() => {}, 100)
  `)
  const child = spawn(process.execPath, [cliPath, 'run-many', '--target=build', '--projects-json', '["lib"]'], {
    cwd: root,
    stdio: 'ignore'
  })
  let pid

  t.onTestFinished(() => {
    child.kill('SIGKILL')

    if (pid) {
      try {
        process.kill(pid, 'SIGKILL')
      } catch (error) {
        if (error.code !== 'ESRCH') {
          throw error
        }
      }
    }
  })
  const closed = new Promise(resolve => child.once('close', (code, signal) => resolve({
    code,
    signal
  })))

  for (let attempt = 0; attempt < 100 && !pid; attempt++) {
    try {
      pid = Number(await readFile(join(root, 'ready'), 'utf8'))
    } catch (error) {
      if (error.code !== 'ENOENT') {
        throw error
      }

      await delay(20)
    }
  }

  assert.ok(pid, 'executor subprocess did not start')
  child.kill('SIGTERM')
  assert.deepEqual(await closed, {
    code: 143,
    signal: null
  })
  assert.throws(() => process.kill(pid, 0), { code: 'ESRCH' })
})
