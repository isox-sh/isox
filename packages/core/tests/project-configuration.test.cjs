const { test } = require('node:test')
const assert = require('node:assert/strict')
const { resolve } = require('node:path')
const { pathToFileURL } = require('node:url')
const { parseProjectDefinition } = require('../dist/workspace/configuration')
const isoxSchema = pathToFileURL(resolve(__dirname, '../schemas/project.schema.json')).href

test('accepts the Isox project definition and preserves executor options', () => {
  const project = {
    $schema: '../core/schemas/project.schema.json',
    name: 'cli',
    dependencies: ['core'],
    commands: {
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
    { commands: [] },
    { commands: { build: {} } },
    { commands: { build: { executor: 'invalid' } } },
    { commands: { build: { executor: 'pkg:build', options: [] } } },
    { commands: { build: { executor: 'pkg:build', configurations: [] } } },
    { commands: { build: { executor: 'pkg:build', configurations: { production: null } } } },
    { commands: { build: { executor: 'pkg:build', configurations: { production: [] } } } },
    { commands: { build: { executor: 'pkg:build', defaultConfiguration: 42 } } },
    { commands: { build: { executor: 'pkg:build', defaultConfiguration: '' } } },
    { commands: { 'bad:name': { executor: 'pkg:build' } } },
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
    commands: {
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
      commands: targets,
      dependencies: implicitDependencies,
    })
    assert.deepEqual(project, original)
  }
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
    const project = { ...($schema ? { $schema } : {}), targets: { custom: true }, implicitDependencies: ['metadata'] }
    assert.deepEqual(parseProjectDefinition(project, 'project.json'), project)
  }
})

test('validates migrated fields and rejects ambiguous mappings with file-specific errors', () => {
  const $schema = '../../node_modules/nx/schemas/project-schema.json'
  for (const fields of [
    { targets: [] },
    { targets: { build: { executor: 'invalid' } } },
    { implicitDependencies: 'shared' },
    { targets: {}, commands: {} },
    { implicitDependencies: [], dependencies: [] },
  ]) {
    assert.throws(() => parseProjectDefinition({ $schema, ...fields }, 'apis/dashboard/project.json'),
      /Invalid project configuration in apis\/dashboard\/project.json/)
  }
  assert.deepEqual(parseProjectDefinition({ $schema, custom: 42 }, 'project.json'), { $schema: isoxSchema, custom: 42 })
})
