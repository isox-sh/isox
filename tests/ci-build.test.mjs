import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { mkdir, mkdtemp, readFile, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'

import { onTestFinished, test } from 'vitest'

import { workerArgs } from '../actions/run-many/index.mjs'

test.each([1, 2, 4])('CI cached builds respect dependencies and the concurrency limit with parallel=%i', async parallel => {
  const root = await mkdtemp(join(tmpdir(), 'isox-ci-build-'))

  onTestFinished(() => rm(root, {
    recursive: true,
    force: true
  }))
  const write = async (path, value) => {
    await mkdir(dirname(join(root, path)), { recursive: true })
    await writeFile(join(root, path), typeof value === 'string' ? value : JSON.stringify(value))
  }

  const workflow = await readFile(new URL('../.github/workflows/pull-requests.yml', import.meta.url), 'utf8')
  const targetOptions = JSON.parse(workflow.match(/targetOptions: '([^']+)'/)[1])

  await write('isox.json', {})
  await write('dist/dependency/index.d.ts', 'bootstrapped dependency')
  for (const name of ['dependency', 'consumer', 'independent']) {
    await write(`apps/${name}/project.json`, {
      name,
      ...(name === 'consumer' ? { dependencies: [parallel === 4 ? 'intermediate' : 'dependency'] } : {}),
      targets: {
        build: {
          executor: 'core:run-command',
          cache: true,
          outputs: [`dist/${name}`],
          options: { command: `node ${name}.cjs` }
        }
      }
    })
  }

  if (parallel === 4) {
    await write('apps/intermediate/project.json', {
      name: 'intermediate',
      dependencies: ['dependency'],
      targets: {}
    })
  }

  await write('dependency.cjs', `
    const fs = require('node:fs')
    fs.writeFileSync('dependency-started', '')
    const started = Date.now()
    const timer = setInterval(() => {
      if (${parallel} > 1 && !fs.existsSync('independent-started')) {
        if (Date.now() - started > 8000) process.exit(1)
        return
      }
      clearInterval(timer)
      fs.mkdirSync('dist/dependency', { recursive: true })
      fs.writeFileSync('dist/dependency/index.d.ts', 'rebuilt dependency')
    }, 50)
  `)
  await write('consumer.cjs', `
    const fs = require('node:fs')
    if (fs.readFileSync('dist/dependency/index.d.ts', 'utf8') !== 'rebuilt dependency') process.exit(1)
    fs.mkdirSync('dist/consumer', { recursive: true })
    fs.writeFileSync('dist/consumer/result', 'compiled')
  `)
  await write('independent.cjs', `
    const fs = require('node:fs')
    fs.writeFileSync('independent-started', '')
    fs.mkdirSync('dist/independent', { recursive: true })
    fs.writeFileSync('dist/independent/result', 'compiled')
  `)
  assert.equal(targetOptions.build.parallel, 2)
  const args = workerArgs({
    target: 'build',
    projects: ['consumer', 'dependency', 'independent'],
    parallel,
    preTargets: [],
    postTargets: []
  })
  const result = spawnSync(process.execPath, [resolve('dist/cli/index.js'), ...args], {
    cwd: root,
    encoding: 'utf8',
    env: {
      ...process.env,
      ISOX_SKIP_CACHE: '',
      ISOX_PROGRESS: '0'
    },
    timeout: 30000
  })

  assert.equal(result.status, 0, result.stderr + result.stdout)
  assert.equal(await readFile(join(root, 'dist/consumer/result'), 'utf8'), 'compiled')
})

test.each([2, 4])('executor rebuilds cannot remove a parallel worker runtime with parallel=%i', async parallel => {
  const root = await mkdtemp(join(tmpdir(), 'isox-runtime-build-'))

  onTestFinished(() => rm(root, {
    recursive: true,
    force: true
  }))
  const write = async (path, value) => {
    await mkdir(dirname(join(root, path)), { recursive: true })
    await writeFile(join(root, path), typeof value === 'string' ? value : JSON.stringify(value))
  }

  const manifest = {
    name: '@fixture/tool',
    version: '1.0.0',
    executors: './executors.json'
  }
  const registry = { executors: { build: { implementation: './executor.cjs' } } }
  const implementation = `
    const fs = require('node:fs')
    module.exports = async (_, context) => {
      const name = context.projectName
      const other = name === 'first' ? 'second' : 'first'
      fs.writeFileSync(name + '-started', '')
      const started = Date.now()
      while (!fs.existsSync(other + '-started')) {
        if (Date.now() - started > 8000) throw new Error('Independent builds were serialized')
        await new Promise(resolve => setTimeout(resolve, 20))
      }
      await new Promise(resolve => setTimeout(resolve, 100))
      fs.readFileSync(__filename)
      fs.mkdirSync('dist/' + name, { recursive: true })
      fs.writeFileSync('dist/' + name + '/result', 'compiled')
      return { success: true }
    }
  `

  await write('isox.json', {})
  await write('packages/tool/package.json', manifest)
  await write('dist/tool/package.json', manifest)
  await write('dist/tool/executors.json', registry)
  await write('dist/tool/executor.cjs', implementation)
  await write('tool-source.cjs', implementation)
  await write('rebuild.cjs', `
    const fs = require('node:fs')
    setTimeout(() => {
      fs.mkdirSync('dist/tool', { recursive: true })
      fs.copyFileSync('packages/tool/package.json', 'dist/tool/package.json')
      fs.writeFileSync('dist/tool/executors.json', ${JSON.stringify(JSON.stringify(registry))})
      fs.copyFileSync('tool-source.cjs', 'dist/tool/executor.cjs')
    }, 300)
  `)
  await mkdir(join(root, 'node_modules/@fixture'), { recursive: true })
  await symlink(join(root, 'dist/tool'), join(root, 'node_modules/@fixture/tool'), 'junction')
  for (const name of ['tool', 'first', 'second']) {
    await write(`packages/${name}/project.json`, {
      name,
      targets: {
        build: {
          executor: name === 'tool' ? 'core:run-command' : '@fixture/tool:build',
          cache: true,
          outputs: [`dist/${name}`],
          options: name === 'tool' ? { command: 'node rebuild.cjs' } : {}
        }
      }
    })
  }

  const result = spawnSync(process.execPath, [resolve('dist/cli/index.js'), 'run-many', '--target=build', '--projects-json', '["tool","first","second"]', '--parallel', String(parallel)], {
    cwd: root,
    encoding: 'utf8',
    env: {
      ...process.env,
      ISOX_SKIP_CACHE: '',
      ISOX_PROGRESS: '0'
    },
    timeout: 30000
  })

  assert.equal(result.status, 0, result.stderr + result.stdout)
  for (const name of ['first', 'second']) {
    assert.equal(await readFile(join(root, `dist/${name}/result`), 'utf8'), 'compiled')
  }
})
