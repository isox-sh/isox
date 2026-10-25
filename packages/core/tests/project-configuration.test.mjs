import { createRequire } from 'node:module'

import { test } from 'vitest'

const require = createRequire(import.meta.url)
const __dirname = import.meta.dirname
const assert = require('node:assert/strict')
const { resolve } = require('node:path')
const { pathToFileURL } = require('node:url')
const { parseProjectDefinition } = require('../../../dist/core/workspace/configuration')
const isoxSchema = pathToFileURL(resolve(__dirname, '../../../dist/core/schemas/project.schema.json')).href

test('accepts the Isox project definition and preserves executor options', () => {
  const project = {
    $schema: '../core/schemas/project.schema.json',
    name: 'cli',
    dependencies: ['core'],
    targets: {
      build: {
        executor: 'js:tsc',
        options: { tsConfig: 'packages/cli/tsconfig.json' },
      },
    },
    tags: [],
  }
  assert.deepEqual(parseProjectDefinition(project, 'packages/cli/project.json'), project)
})

test('validates project fields against the published schema with file-specific errors', () => {
  for (const project of [
    { name: '' },
    { name: 'app:build' },
    { name: 'two words' },
    { dependencies: 'core' },
    { dependencies: ['core', 'core'] },
    { targets: [] },
    { targets: { build: {} } },
    { targets: { build: { executor: 'invalid' } } },
    { targets: { build: { executor: 'pkg:build', options: [] } } },
    { targets: { build: { executor: 'pkg:build', configurations: [] } } },
    { targets: { build: { executor: 'pkg:build', configurations: { production: null } } } },
    { targets: { build: { executor: 'pkg:build', configurations: { production: [] } } } },
    { targets: { build: { executor: 'pkg:build', defaultConfiguration: 42 } } },
    { targets: { build: { executor: 'pkg:build', defaultConfiguration: '' } } },
    { targets: { 'bad:name': { executor: 'pkg:build' } } },
    { tags: [42] },
  ]) {
    assert.throws(
      () => parseProjectDefinition(project, 'apps/demo/project.json'),
      /Invalid project configuration in apps\/demo\/project.json: project/,
    )
  }
})

test('preserves additional project and command properties for consumers', () => {
  const project = {
    name: 'dashboard',
    sourceRoot: 'apis/dashboard/src',
    projectType: 'application',
    custom: { owner: 'dashboard-team', enabled: true, values: [1, null] },
    targets: {
      build: {
        executor: '@nx/js:tsc',
        options: { main: 'apis/dashboard/src/index.ts' },
        outputs: ['dist/dashboard'],
        custom: { region: 'eu' },
      },
    },
  }
  assert.deepEqual(parseProjectDefinition(project, 'project.json'), project)
  assert.throws(() => parseProjectDefinition({ ...project, dependencies: 'invalid' }, 'project.json'), /must be array/)
})

test('migrates recognized Nx schemas in memory and preserves options and metadata', () => {
  for (const $schema of [
    '../../node_modules/nx/schemas/project-schema.json',
    'nx/schemas/project-schema.json',
    '../../node_modules/@nrwl/workspace/schemas/project-schema.json',
    '..\\..\\node_modules\\nx\\schemas\\project-schema.json',
    'file:///workspace/node_modules/nx/schemas/project-schema.json',
    'https://nx.dev/reference/project-configuration',
    'https://nx.dev/docs/reference/project-configuration/#definition',
    'https://raw.githubusercontent.com/nrwl/nx/master/packages/nx/schemas/project-schema.json',
    'HTTPS://NX.DEV/reference/project-configuration',
  ]) {
    const project = {
      $schema,
      name: 'dashboard',
      sourceRoot: 'apis/dashboard/src',
      projectType: 'application',
      implicitDependencies: ['shared'],
      tags: ['api'],
      custom: { owner: 'dashboard-team' },
      targets: {
        build: {
          executor: '@nx/js:tsc',
          options: { main: 'apis/dashboard/src/main.ts' },
          configurations: { production: { main: 'apis/dashboard/src/production.ts' } },
          defaultConfiguration: 'production',
          outputs: ['dist/dashboard'],
          custom: { region: 'eu' },
        },
      },
    }
    const original = structuredClone(project)
    const migrated = parseProjectDefinition(project, 'apis/dashboard/project.json')
    const { targets, implicitDependencies, ...metadata } = project
    assert.deepEqual(migrated, {
      ...metadata,
      $schema: isoxSchema,
      targets,
      dependencies: implicitDependencies,
    })
    assert.deepEqual(project, original)
  }
})

test('skips Nx targets without executors without changing the source definition', () => {
  const project = {
    $schema: '../../node_modules/nx/schemas/project-schema.json',
    targets: {
      build: { executor: '@nx/js:tsc', options: { tsConfig: 'tsconfig.json' } },
      'extract-translations': { options: { outputPath: 'locales' } },
      prepare: { dependsOn: ['build'] },
      inferred: {},
      script: { command: 'node script.js' },
    },
  }
  const original = structuredClone(project)
  assert.deepEqual(parseProjectDefinition(project, 'libs/emails/project.json').targets, { build: project.targets.build })
  assert.deepEqual(project, original)
  assert.deepEqual(parseProjectDefinition({ $schema: project.$schema, targets: { inferred: {} } }, 'project.json').targets, {})
})

test('uses the schema rather than field names to select Nx migration', () => {
  for (const $schema of [
    undefined,
    '../core/schemas/project.schema.json',
    'https://example.com/nx/schemas/project-schema.json',
    '../../node_modules/nx/schemas/workspace-schema.json',
    '../../node_modules/not-nx/schemas/project-schema.json',
    'https://[',
  ]) {
    const project = { ...($schema ? { $schema } : {}), targets: { custom: { executor: 'core:run-command' } }, implicitDependencies: ['metadata'] }
    assert.deepEqual(parseProjectDefinition(project, 'project.json'), project)
    assert.throws(() => parseProjectDefinition({ ...project, targets: { inferred: {} } }, 'project.json'), /required property 'executor'/)
  }
})

test('validates migrated fields and rejects ambiguous mappings with file-specific errors', () => {
  const $schema = '../../node_modules/nx/schemas/project-schema.json'
  for (const fields of [
    { targets: [] },
    { targets: null },
    { targets: { build: null } },
    { targets: { build: [] } },
    { targets: { build: 'command' } },
    { targets: { build: { executor: null } } },
    { targets: { build: { executor: '' } } },
    { targets: { build: { executor: 'invalid' } } },
    { implicitDependencies: 'shared' },
    { implicitDependencies: [], dependencies: [] },
  ]) {
    assert.throws(() => parseProjectDefinition({ $schema, ...fields }, 'apis/dashboard/project.json'),
      /Invalid project configuration in apis\/dashboard\/project.json/)
  }
  assert.deepEqual(parseProjectDefinition({ $schema, custom: 42 }, 'project.json'), { $schema: isoxSchema, custom: 42 })
})
