import assert from 'node:assert/strict'
import { createRequire } from 'node:module'

import { test } from 'vitest'

const require = createRequire(import.meta.url)

test('the JS package infers the native compiler alias from the workspace root', () => {
  const source = require('../packages/js/package.json')
  const root = require('../package.json')
  const generated = require('../dist/js/package.json')

  assert.equal(source.dependencies['@typescript/native'], undefined)
  assert.equal(generated.dependencies['@typescript/native'], root.devDependencies['@typescript/native'])
})

test('published packages retain internal dependencies removed from source manifests', () => {
  const core = require('../dist/core/package.json')

  for (const name of ['cli', 'js', 'eslint', 'vitest', 'nx', 'e2e']) {
    const source = require(`../packages/${name}/package.json`)
    const generated = require(`../dist/${name}/package.json`)

    assert.equal(source.dependencies?.['@isox-sh/core'], undefined)
    assert.equal(generated.dependencies['@isox-sh/core'], core.version, name)
  }

  assert.equal(core.dependencies['@isox-sh/nx'], undefined, 'The optional Nx adapter must remain a workspace-selected plugin')
})
