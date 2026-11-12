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
    for (const file of ['project.json', 'tsconfig.build.json']) {
      assert.ok(JSON.parse(await fs.readFile(join(projectRoot, file), 'utf8')))
    }

    assert.ok(JSON.parse(await fs.readFile(join(root, 'tsconfig.json'), 'utf8')).compilerOptions.noEmit)
    await assert.rejects(fs.stat(join(projectRoot, 'tsconfig.json')), { code: 'ENOENT' })
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

test('initialization registers build cache defaults matching the scaffold output directory', async t => {
  const { root, context } = await fixture(t)
  const projectRoot = join(root, 'packages/created')

  await fs.writeFile(join(root, 'isox.json'), '{"version":"1","custom":true}')
  await init({}, {
    ...context,
    projectRoot,
    projectName: 'created'
  })
  const settings = JSON.parse(await fs.readFile(join(root, 'isox.json'), 'utf8'))
  const project = JSON.parse(await fs.readFile(join(projectRoot, 'project.json'), 'utf8'))
  const config = JSON.parse(await fs.readFile(join(projectRoot, 'tsconfig.build.json'), 'utf8'))

  assert.deepEqual(settings, {
    version: '1',
    custom: true,
    targetDefaults: {
      'js:tsc': {
        cache: true,
        outputs: ['{workspaceRoot}/dist/{projectRoot}']
      }
    },
  })
  assert.equal(project.targets.build.executor, 'js:tsc')
  assert.equal(config.compilerOptions.outDir, '../../dist/packages/created')
})

test('initialization preserves configured scoped defaults, including cache opt-out and output overrides', async t => {
  const { root, context } = await fixture(t)
  const settings = {
    targetDefaults: {
      '@isox-sh/js:tsc': {
        cache: false,
        outputs: ['custom'],
        options: { clean: false }
      }
    }
  }

  await fs.writeFile(join(root, 'isox.json'), JSON.stringify(settings))
  await init({}, {
    ...context,
    projectRoot: join(root, 'packages/created'),
    projectName: 'created'
  })
  assert.deepEqual(JSON.parse(await fs.readFile(join(root, 'isox.json'), 'utf8')), settings)
})

test('a different workspace output layout gets a local override matching the new compiler config', async t => {
  const { root, context } = await fixture(t)
  const settings = {
    targetDefaults: {
      'js:tsc': {
        cache: true,
        outputs: ['{workspaceRoot}/dist/{projectName}']
      }
    }
  }
  const projectRoot = join(root, 'packages/created')

  await fs.writeFile(join(root, 'isox.json'), JSON.stringify(settings))
  await init({}, {
    ...context,
    projectRoot,
    projectName: 'created'
  })
  const project = JSON.parse(await fs.readFile(join(projectRoot, 'project.json'), 'utf8'))

  assert.deepEqual(project.targets.build.outputs, ['{workspaceRoot}/dist/{projectRoot}'])
  assert.deepEqual(JSON.parse(await fs.readFile(join(root, 'isox.json'), 'utf8')), settings)
})

test('initialization updates one root editor config while preserving JSONC and custom settings', async t => {
  const { root, context } = await fixture(t)
  await fs.writeFile(join(root, 'tsconfig.json'), `{
    // editor settings
    "extends": "./custom.json",
    "compilerOptions": { "jsx": "react-jsx" },
    "include": ["tools/**/*.ts"],
    "exclude": ["dist"],
    "references": [],
  }`)
  for (const name of ['first', 'second']) {
    await init({}, {
      ...context,
      projectRoot: join(root, 'libraries', name),
      projectName: name
    })
  }

  const source = await fs.readFile(join(root, 'tsconfig.json'), 'utf8')
  const { parse } = require('jsonc-parser')
  const config = parse(source)
  assert.match(source, /\/\/ editor settings/)
  assert.equal(config.extends, './custom.json')
  assert.equal(config.compilerOptions.jsx, 'react-jsx')
  assert.deepEqual(config.include, ['tools/**/*.ts', './libraries/first/src/**/*.ts', './libraries/second/src/**/*.ts'])
  assert.deepEqual(config.exclude, ['dist'])
  assert.deepEqual(config.references, [])
  const project = JSON.parse(await fs.readFile(join(root, 'libraries/second/project.json'), 'utf8'))
  assert.equal(project.$schema, `https://unpkg.com/@isox-sh/core@${require('../../../dist/core/package.json').version}/schemas/project.schema.json`)
})

for (const source of ['{broken', '{"include":null}', '{"compilerOptions":[]}']) {
  test(`invalid root editor config prevents initialization: ${source}`, async t => {
    const { root, context } = await fixture(t)
    await fs.writeFile(join(root, 'tsconfig.json'), source)
    const projectRoot = join(root, 'packages/new')
    await assert.rejects(init({}, {
      ...context,
      projectRoot,
      projectName: 'new'
    }), /Invalid TypeScript configuration/)
    await assert.rejects(fs.stat(projectRoot), { code: 'ENOENT' })
    await assert.rejects(fs.stat(join(root, 'tsconfig.base.json')), { code: 'ENOENT' })
    assert.equal(await fs.readFile(join(root, 'tsconfig.json'), 'utf8'), source)
  })
}

test('initialization rejects a symlinked root editor config without modifying its target', async t => {
  const { root, context } = await fixture(t)
  const original = '{"compilerOptions":{"strict":false}}'
  await fs.writeFile(join(root, 'shared.json'), original)
  await fs.symlink('shared.json', join(root, 'tsconfig.json'))
  const projectRoot = join(root, 'packages/new')
  await assert.rejects(init({}, {
    ...context,
    projectRoot,
    projectName: 'new'
  }), /symlink/)
  assert.equal(await fs.readFile(join(root, 'shared.json'), 'utf8'), original)
  await assert.rejects(fs.stat(projectRoot), { code: 'ENOENT' })
})

test('project schemas use a relative local path when core is installed directly', async t => {
  const { root, context } = await fixture(t)
  const schemaRoot = join(root, 'node_modules/@isox-sh/core/schemas')
  await fs.mkdir(schemaRoot, { recursive: true })
  await fs.writeFile(join(schemaRoot, 'project.schema.json'), '{}')
  const projectRoot = join(root, 'apps/deep/new')
  await init({}, {
    ...context,
    projectRoot,
    projectName: 'new'
  })
  const project = JSON.parse(await fs.readFile(join(projectRoot, 'project.json'), 'utf8'))
  assert.equal(project.$schema, '../../../node_modules/@isox-sh/core/schemas/project.schema.json')
})

for (const stage of ['source', 'editor']) {
  test(`a ${stage} write failure leaves the base config and ESLint workspace setup untouched`, async t => {
    const { root, context } = await fixture(t)
    const projectRoot = join(root, 'packages/created')
    const base = '{"compilerOptions":{"strict":true}}'
    await fs.writeFile(join(root, 'tsconfig.base.json'), base)
    const method = stage === 'source' ? 'writeFile' : 'link'
    const original = fs[method]
    const spy = vi.spyOn(fs, method).mockImplementation(async (...args) => {
      const destination = stage === 'source' ? args[0] : args[1]
      if (destination === join(stage === 'source' ? projectRoot : root, stage === 'source' ? 'src/index.ts' : 'tsconfig.json')) {
        throw Object.assign(new Error('injected scaffold failure'), { code: 'EACCES' })
      }

      return original(...args)
    })
    t.onTestFinished(() => spy.mockRestore())

    await assert.rejects(init({ importPath: '@org/created' }, {
      ...context,
      projectRoot,
      projectName: 'created'
    }), /injected scaffold failure/)
    assert.equal(await fs.readFile(join(root, 'tsconfig.base.json'), 'utf8'), base)
    for (const file of ['package.json', 'eslint.config.mjs', 'tsconfig.json', 'packages/created']) {
      await assert.rejects(fs.stat(join(root, file)), { code: 'ENOENT' })
    }
  })
}

for (const existingEditor of [false, true]) {
  test(`a base publish failure restores the editor config (existing: ${existingEditor})`, async t => {
    const { root, context } = await fixture(t)
    const projectRoot = join(root, 'packages/created')
    const editor = '{\n // keep editor settings\n "compilerOptions": { "jsx": "react-jsx" }\n}\n'
    if (existingEditor) {
      await fs.writeFile(join(root, 'tsconfig.json'), editor, { mode: 0o640 })
    }

    const original = fs.link
    const spy = vi.spyOn(fs, 'link').mockImplementation(async (source, destination) => {
      if (destination === join(root, 'tsconfig.base.json')) {
        throw Object.assign(new Error('injected base failure'), { code: 'EACCES' })
      }

      return original(source, destination)
    })
    t.onTestFinished(() => spy.mockRestore())

    await assert.rejects(init({}, {
      ...context,
      projectRoot,
      projectName: 'created'
    }), /injected base failure/)
    if (existingEditor) {
      assert.equal(await fs.readFile(join(root, 'tsconfig.json'), 'utf8'), editor)
      assert.equal((await fs.stat(join(root, 'tsconfig.json'))).mode & 0o777, 0o640)
    } else {
      await assert.rejects(fs.stat(join(root, 'tsconfig.json')), { code: 'ENOENT' })
    }

    for (const file of ['tsconfig.base.json', 'package.json', 'eslint.config.mjs', 'packages/created']) {
      await assert.rejects(fs.stat(join(root, file)), { code: 'ENOENT' })
    }
  })
}
