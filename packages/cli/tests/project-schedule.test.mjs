import assert from 'node:assert/strict'
import { stat } from 'node:fs/promises'
import { join } from 'node:path'

import { test } from 'vitest'

import { createProjectSchedule } from '../../../dist/cli/shared/project-schedule.js'
import { parseWorkspace } from '../../../dist/core/index.js'
import { affectedFixture } from './helpers/affected-fixture.mjs'

test('dependency scheduling unblocks consumers after completion and releases waiters on cancellation', async t => {
  const { root } = await affectedFixture(t)
  const workspace = await parseWorkspace(root)

  Object.assign(workspace.projects.lib.targets.build, {
    cache: true,
    outputs: ['dist/lib']
  })
  for (const cancelled of [false, true]) {
    const controller = new AbortController()
    const schedule = await createProjectSchedule(root, workspace, ['app', 'lib', 'other'], 'build', controller.signal)

    assert.equal(await schedule.next(), 'lib')
    assert.equal(await schedule.next(), 'other')
    let consumerStarted = false
    const waiting = schedule.next().then(name => {
      consumerStarted = name !== undefined

      return name
    })

    schedule.done('other')
    await Promise.resolve()
    assert.equal(consumerStarted, false)
    if (cancelled) {
      controller.abort()
    } else {
      schedule.done('lib')
    }

    assert.equal(await waiting, cancelled ? undefined : 'app')
    assert.equal(await schedule.next(), undefined)
  }
})

test('targets without cached outputs preserve selection order and skip dependency analysis', async t => {
  const { root } = await affectedFixture(t)
  const workspace = await parseWorkspace(root)
  const schedule = await createProjectSchedule(root, workspace, ['app', 'lib'], 'build', new AbortController().signal)

  assert.equal(await schedule.next(), 'app')
  assert.equal(await schedule.next(), 'lib')
  assert.equal(await schedule.next(), undefined)
  await assert.rejects(stat(join(root, '.isox/discovery.json')), { code: 'ENOENT' })
})

test('cached output scheduling rejects dependency cycles instead of leaving workers waiting', async t => {
  const { root } = await affectedFixture(t)
  const workspace = await parseWorkspace(root)

  Object.assign(workspace.projects.lib.targets.build, {
    cache: true,
    outputs: ['dist/lib']
  })
  workspace.projects.lib.dependencies = ['app']
  await assert.rejects(
    createProjectSchedule(root, workspace, ['app', 'lib'], 'build', new AbortController().signal),
    /Project dependency cycle/,
  )
})

test('runtime inspection leaves JavaScript executor registries to the worker', async t => {
  const { root, write } = await affectedFixture(t)
  const workspace = await parseWorkspace(root)

  Object.assign(workspace.projects.lib.targets.build, {
    cache: true,
    outputs: ['dist/lib']
  })
  await write('node_modules/@fixture/plugin/package.json', {
    name: '@fixture/plugin',
    executors: './executors.cjs'
  })
  await write('node_modules/@fixture/plugin/executors.cjs', `
    require('node:fs').writeFileSync(${JSON.stringify(join(root, 'registry-loaded'))}, '')
    module.exports = { executors: { record: { implementation: './record.cjs' } } }
  `)
  const schedule = await createProjectSchedule(root, workspace, ['app', 'lib'], 'build', new AbortController().signal)

  assert.equal(await schedule.next(), 'lib')
  await assert.rejects(stat(join(root, 'registry-loaded')), { code: 'ENOENT' })
})
