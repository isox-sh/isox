import assert from 'node:assert/strict'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'

import { readJson, writeJson } from '@isox-sh/core'
import { createWorkspace } from '@isox-sh/e2e'
import { test } from 'vitest'

import { workerArgs } from '../../../actions/run-many/index.mjs'

async function createSuite(t) {
  const { root, runIsox, cleanup } = await createWorkspace({
    startDirectory: import.meta.dirname,
    plugins: {
      '@isox-sh/playwright': 'dist/playwright',
      '@playwright/test': 'packages/playwright/node_modules/@playwright/test',
    },
  })
  t.onTestFinished(cleanup)
  await runIsox(['init'])
  const projectRoot = join(root, 'apps/web')
  const project = { projectRoot }
  await mkdir(projectRoot, { recursive: true })
  await writeJson('project.json', { name: 'web' }, project)
  await runIsox(['add', '@isox-sh/playwright', 'web'])

  const write = (file, source) => writeFile(join(projectRoot, file), source)
  const spec = (file, titles, focused = false) => write(file, `
    const { test } = require('@playwright/test')
    const { appendFileSync } = require('node:fs')
    for (const title of ${JSON.stringify(titles)}) {
      test${focused ? '.only' : ''}(title, ({}, info) => {
        const shard = info.config.shard
        appendFileSync('visits.jsonl', JSON.stringify({ title, shard: shard && shard.current + '/' + shard.total }) + '\\n')
      })
    }
  `)
  const plan = async (maxJobs = 3) => {
    const { stdout } = await runIsox(['plan', '--all', '--target=e2e', `--max-jobs=${maxJobs}`])

    return JSON.parse(stdout).include
  }

  const visits = async () => (await readFile(join(projectRoot, 'visits.jsonl'), 'utf8')).trim().split('\n').map(line => JSON.parse(line))
  const compareRuns = async (rows, expected) => {
    await write('visits.jsonl', '')
    await runIsox(['e2e', 'web'])
    const direct = await visits()
    assert.deepEqual(direct.map(event => event.title).sort(), [...expected].sort())
    await write('visits.jsonl', '')
    for (const row of rows) {
      assert.deepEqual(row.projects, ['web'])
      await runIsox(workerArgs(row))
    }

    const planned = await visits()
    assert.deepEqual(planned.map(event => event.title).sort(), direct.map(event => event.title).sort())

    return planned
  }

  return {
    project,
    spec,
    write,
    plan,
    compareRuns
  }
}

test('executes the exact requested shards through the worker action', async t => {
  const { project, plan, spec, compareRuns } = await createSuite(t)
  const definition = await readJson('project.json', project)
  definition.targets.e2e.planner.shards = 3
  await writeJson('project.json', definition, project)
  const titles = ['one', 'two', 'three']
  for (const title of titles) {
    await spec(`${title}.spec.cjs`, [title])
  }

  const rows = await plan()
  assert.deepEqual(rows.map(row => row.options.shard), ['1/3', '2/3', '3/3'])
  const events = await compareRuns(rows, titles)
  assert.deepEqual(events.map(event => event.shard).sort(), ['1/3', '2/3', '3/3'])
})

test('auto executes only populated shards and preserves their original denominator', async t => {
  const { spec, plan, compareRuns } = await createSuite(t)
  await spec('a.spec.cjs', ['one', 'two'])
  await spec('b.spec.cjs', ['three'])

  const rows = await plan()
  assert.deepEqual(rows.map(row => row.options.shard), ['1/3', '3/3'])
  const events = await compareRuns(rows, ['one', 'two', 'three'])
  assert.deepEqual(events.map(event => event.shard).sort(), ['1/3', '1/3', '3/3'])
})

for (const selection of ['focus', 'reporter']) {
  test(`auto keeps all selected tests when ${selection} changes shard assignments`, async t => {
    const { project, write, spec, plan, compareRuns } = await createSuite(t)
    await spec('a.spec.cjs', Array.from({ length: 6 }, (_, i) => `ignore-${i}`))
    const titles = ['b', 'c', 'd']
    for (const title of titles) {
      await spec(`${title}.spec.cjs`, [title], selection === 'focus')
    }

    if (selection === 'reporter') {
      await write('filter.cjs', `
        module.exports = class {
          async preprocess({ suite, testRun }) {
            for (const test of suite.allTests()) {
              if (test.title.startsWith('ignore-')) testRun.exclude(test)
            }
          }
        }
      `)
      await write('playwright.config.cjs', "module.exports = { reporter: [['./filter.cjs'], ['junit', { outputFile: 'results.xml' }]] }")
      await write('results.xml', 'previous run')
    }

    const rows = await plan()
    if (selection === 'reporter') {
      assert.equal(await readFile(join(project.projectRoot, 'results.xml'), 'utf8'), 'previous run')
      assert.deepEqual(rows.map(row => row.options.shard), ['1/3', '2/3', '3/3'])
    }

    await compareRuns(rows, titles)
  })
}

test('auto preserves a shard selected in the Playwright configuration', async t => {
  const { spec, write, plan, compareRuns } = await createSuite(t)
  await write('playwright.config.cjs', 'module.exports = { fullyParallel: true, shard: { current: 1, total: 2 } }')
  await spec('tests.spec.cjs', ['one', 'two', 'three', 'four'])
  const rows = await plan()
  assert.deepEqual(rows.map(row => row.options), [undefined])
  const events = await compareRuns(rows, ['one', 'two'])
  assert.ok(events.every(event => event.shard === '1/2'))
})

test('leaves discovery to the worker when global setup provides the test inputs', async t => {
  const { spec, write, plan, compareRuns } = await createSuite(t)
  await write('playwright.config.cjs', "module.exports = { globalSetup: './setup.cjs' }")
  await write('setup.cjs', "module.exports = () => { process.env.TEST_DATA_READY = 'yes' }")
  await write('guard.spec.cjs', "if (!process.env.TEST_DATA_READY) throw new Error('Test data requires global setup')")
  await spec('tests.spec.cjs', ['one', 'two', 'three'])
  const rows = await plan()
  assert.deepEqual(rows.map(row => row.options), [undefined])
  await compareRuns(rows, ['one', 'two', 'three'])
})
