import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'

import { test } from 'vitest'

import { workerArgs } from '../actions/run-many/index.mjs'

test('CI build workers retain bootstrapped dependency outputs while rebuilding cached targets', async t => {
  const root = await mkdtemp(join(tmpdir(), 'isox-ci-build-'))

  t.onTestFinished(() => rm(root, {
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
  for (const name of ['dependency', 'consumer']) {
    await write(`apps/${name}/project.json`, {
      name,
      ...(name === 'consumer' ? { dependencies: ['dependency'] } : {}),
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

  await write('dependency.cjs', `
    setTimeout(() => {
      const fs = require('node:fs')
      fs.mkdirSync('dist/dependency', { recursive: true })
      fs.writeFileSync('dist/dependency/index.d.ts', 'rebuilt dependency')
    }, 500)
  `)
  await write('consumer.cjs', `
    const fs = require('node:fs')
    fs.readFileSync('dist/dependency/index.d.ts')
    fs.mkdirSync('dist/consumer', { recursive: true })
    fs.writeFileSync('dist/consumer/result', 'compiled')
  `)
  const args = workerArgs({
    target: 'build',
    projects: ['dependency', 'consumer'],
    parallel: targetOptions.build.parallel,
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
