import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { join } from 'node:path'

import { test, vi } from 'vitest'

import { fixture } from './fixture.mjs'

const require = createRequire(import.meta.url)
const fs = require('node:fs/promises')
const { default: init } = require('../../../dist/js/generators/init')

for (const code of ['ENOTSUP', 'EPERM', 'EXDEV']) {
  test(`initialization creates every config when hard links fail with ${code}`, async t => {
    const { root, context } = await fixture(t)
    const projectRoot = join(root, 'packages/created')
    const spy = vi.spyOn(fs, 'link').mockRejectedValue(Object.assign(new Error('links unavailable'), { code }))

    t.onTestFinished(() => spy.mockRestore())
    await init({}, {
      ...context,
      projectRoot,
      projectName: 'created'
    })
    for (const file of ['project.json', 'tsconfig.json', 'tsconfig.build.json']) {
      assert.ok(JSON.parse(await fs.readFile(join(projectRoot, file), 'utf8')))
    }

    assert.ok(JSON.parse(await fs.readFile(join(root, 'tsconfig.base.json'), 'utf8')).compilerOptions)
  })
}

test('exclusive fallback preserves a base config created by another writer', async t => {
  const { root, context } = await fixture(t)
  const base = join(root, 'tsconfig.base.json')
  const projectRoot = join(root, 'packages/created')
  const spy = vi.spyOn(fs, 'link').mockImplementation(async (_, destination) => {
    if (destination === base) {
      await fs.writeFile(base, '{"raced":true}')
    }

    throw Object.assign(new Error('links unavailable'), { code: 'ENOTSUP' })
  })

  t.onTestFinished(() => spy.mockRestore())
  await assert.rejects(init({}, {
    ...context,
    projectRoot,
    projectName: 'created'
  }), { code: 'EEXIST' })
  assert.equal(await fs.readFile(base, 'utf8'), '{"raced":true}')
  await assert.rejects(fs.stat(projectRoot), { code: 'ENOENT' })
})
