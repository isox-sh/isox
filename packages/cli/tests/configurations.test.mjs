import { createRequire } from 'node:module'

import { test } from 'vitest'

const require = createRequire(import.meta.url)
const __dirname = import.meta.dirname
const assert = require('node:assert/strict')
const { spawnSync } = require('node:child_process')
const { mkdtemp, mkdir, readFile, writeFile, rm, stat, symlink } = require('node:fs/promises')
const { tmpdir } = require('node:os')
const { dirname, join, resolve } = require('node:path')

const cliPath = resolve(__dirname, '../../../dist/cli/index.js')

async function fixture(t, nx = false) {
  const root = await mkdtemp(join(tmpdir(), 'isox-configurations-'))
  t.onTestFinished(() => rm(root, { recursive: true, force: true }))
  const write = async (file, content) => {
    const path = join(root, file)
    await mkdir(dirname(path), { recursive: true })
    await writeFile(path, typeof content === 'string' ? content : JSON.stringify(content))
  }
  if (nx) {
    await mkdir(join(root, 'node_modules/@isox-sh'), { recursive: true })
    await symlink(resolve(__dirname, '../../../dist/nx'), join(root, 'node_modules/@isox-sh/nx'), 'dir')
  }
  const pkg = nx ? '@nx/fixture' : '@fixture/plugin'
  const manifestKey = 'executors'
  const command = {
    executor: `${pkg}:build`,
    options: { keep: 42, mode: 'base', nested: { base: true }, list: ['base'], enabled: true },
    defaultConfiguration: 'development',
    configurations: {
      development: { mode: 'development' },
      production: { mode: 'production', nested: { prod: true }, list: [], enabled: false },
      staging: { mode: 'staging' },
      123: { mode: 'numeric' },
      '001': { mode: 'leading-zero' },
      '=acc': { mode: 'leading-equals' },
    },
  }
  const project = {
    name: 'demo',
    ...(nx ? { $schema: '../../node_modules/nx/schemas/project-schema.json' } : {}),
    targets: { build: command },
  }
  await write('isox.json', { nx: { executors: ['@nx'] } })
  await write('apps/demo/project.json', project)
  await write(`node_modules/${pkg}/package.json`, { [manifestKey]: './registry.json' })
  await write(`node_modules/${pkg}/registry.json`, { [manifestKey]: { build: { implementation: './executor.cjs' } } })
  await write(`node_modules/${pkg}/executor.cjs`, `
    module.exports = (options, context) => {
      const nx = ${nx}
      const command = nx ? context.target : context.command
      require('node:fs').writeFileSync(require('node:path').join(context.root ?? context.workspaceRoot, 'result.json'), JSON.stringify({
        options,
        configurationName: context.configurationName,
        baseOptions: command.options,
        taskGraph: context.taskGraph,
        graphOptions: nx ? context.projectGraph.nodes.demo.data.targets.build.options : context.workspace.projects.demo.targets.build.options,
      }))
      return { success: true }
    }
  `)
  return { root, command, project }
}

function run(root, args) {
  return spawnSync(process.execPath, [cliPath, ...args], { cwd: root, encoding: 'utf8' })
}

for (const nx of [false, true]) {
  test(`${nx ? 'Nx' : 'native'} executors receive merged configurations through both command syntaxes and cached discovery`, async (t) => {
    const { root, command, project } = await fixture(t, nx)
    for (const [args, configuration] of [
      [['build', 'demo', '--prod'], 'production'],
      [['build', 'demo', '--config=production'], 'production'],
      [['run', 'demo:build', '--prod'], 'production'],
      [['run', 'demo:build', '--config', 'staging'], 'staging'],
      [['build', 'demo', '--configuration=staging'], 'staging'],
      [['build', 'demo', '-c', 'staging'], 'staging'],
      [['build', 'demo', '-c=staging'], 'staging'],
      [['--config=production', 'build', 'demo'], 'production'],
      [['build', 'demo', '--prod', '--config=staging'], 'staging'],
      [['build', 'demo', '--config=123'], '123'],
      [['build', 'demo', '--config=001'], '001'],
      [['run', 'demo:build', '-c', '001'], '001'],
      [['run', 'demo:build', '-c=001'], '001'],
      [['build', 'demo', '-c==acc'], '=acc'],
      [['build', 'demo', '-c', '=acc'], '=acc'],
      [['build', 'demo', '--config==acc'], '=acc'],
      [['build', 'demo'], 'development'],
    ]) {
      await rm(join(root, 'result.json'), { force: true })
      const result = run(root, args)
      assert.equal(result.status, 0, `${args.join(' ')}: ${result.stderr}`)
      const output = JSON.parse(await readFile(join(root, 'result.json'), 'utf8'))
      assert.equal(output.configurationName, configuration)
      assert.deepEqual(output.options, { ...command.options, ...command.configurations[configuration] })
      assert.deepEqual(output.baseOptions, command.options)
      assert.deepEqual(output.graphOptions, command.options)
      if (nx) {
        const id = `demo:build:${configuration}`
        assert.deepEqual(output.taskGraph.roots, [id])
        assert.deepEqual(output.taskGraph.tasks[id].target, { project: 'demo', target: 'build', configuration })
        assert.deepEqual(output.taskGraph.dependencies[id], [])
      }
    }
    const cached = JSON.parse(await readFile(join(root, '.isox/workspace.json'), 'utf8'))
    assert.deepEqual(cached.projects.demo.targets.build, command)
    assert.deepEqual(JSON.parse(await readFile(join(root, 'apps/demo/project.json'), 'utf8')), project)
  })
}

test('invalid configuration selections fail without invoking the executor', async (t) => {
  const { root } = await fixture(t)
  for (const [args, message] of [
    [['build', 'demo', '--config=missing'], /Configuration missing not found for demo:build/],
    [['run', 'demo:build', '--config=toString'], /Configuration toString not found/],
    [['build', 'demo', '--config='], /value is missing/],
    [['build', 'demo', '-c='], /value is missing/],
    [['build', 'demo', '--config'], /value is missing/],
    [['build', 'demo', '--config', 'production', '--config', 'staging'], /exactly one configuration/],
    [['build', 'demo', '-c', 'production', '--configuration', 'staging'], /exactly one configuration/],
    [['build', 'demo', '--config=production,staging'], /Invalid configuration name/],
    [['init', '--prod'], /Unknown option/],
    [['reset', '--config=production'], /Unknown option/],
  ]) {
    const result = run(root, args)
    assert.equal(result.status, 1, args.join(' '))
    assert.match(result.stderr, message)
  }
  await assert.rejects(stat(join(root, 'result.json')), { code: 'ENOENT' })
})
