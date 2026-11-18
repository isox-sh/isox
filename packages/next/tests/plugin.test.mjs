import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { mkdir, mkdtemp, readFile, realpath, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'

import { test } from 'vitest'

const dist = resolve(import.meta.dirname, '../../../dist')

async function fixture(t) {
  const root = await mkdtemp(join(tmpdir(), 'isox next '))
  const project = join(root, 'apps/web')

  t.onTestFinished(() => rm(root, {
    recursive: true,
    force: true
  }))
  await mkdir(join(root, 'node_modules/@isox-sh'), { recursive: true })
  await symlink(join(dist, 'next'), join(root, 'node_modules/@isox-sh/next'), 'junction')
  await writeFile(join(root, 'isox.json'), '{}')

  const run = (...args) => spawnSync(process.execPath, [join(dist, 'cli/index.js'), ...args], {
    cwd: root,
    env: {
      ...process.env,
      ISOX_SKIP_CACHE: ''
    },
    encoding: 'utf8',
    timeout: 15_000
  })
  const initialized = run('init', '@isox-sh/next', 'apps/web')

  assert.equal(initialized.status, 0, initialized.stderr)

  return {
    root,
    project,
    run
  }
}

async function installFakeNext(directory) {
  const pkg = join(directory, 'node_modules/next')

  await mkdir(pkg, { recursive: true })
  await writeFile(join(pkg, 'package.json'), JSON.stringify({
    name: 'next',
    version: '16.4.6',
    bin: { next: 'cli.cjs' }
  }))
  await writeFile(join(pkg, 'cli.cjs'), `
    const { mkdirSync, readFileSync, writeFileSync } = require('node:fs')
    const args = process.argv.slice(2)
    if (args[0] === 'build') {
      mkdirSync('.next', { recursive: true })
      writeFileSync('.next/BUILD_ID', 'built')
    }
    if (args[0] === 'start') {
      readFileSync('.next/BUILD_ID')
    }
    console.log('Next CLI', JSON.stringify({ cwd: process.cwd(), args }))
  `)
}

function cliInvocation(result) {
  assert.equal(result.status, 0, result.stderr)

  return JSON.parse(result.stdout.match(/Next CLI (.*)/)[1])
}

test('scaffolds an App Router project and declares shared framework dependencies', async t => {
  const { root, project, run } = await fixture(t)
  const config = JSON.parse(await readFile(join(project, 'project.json'), 'utf8'))

  assert.equal(config.name, 'web')
  assert.deepEqual(config.targets.serve, {
    executor: 'next:serve',
    configurations: { production: { mode: 'production' } }
  })
  assert.match(await readFile(join(project, 'app/layout.jsx'), 'utf8'), /<body>{children}<\/body>/)
  assert.match(await readFile(join(project, 'app/page.jsx'), 'utf8'), /"web"/)

  const manifestPath = join(root, 'package.json')
  const before = await readFile(manifestPath, 'utf8')
  const manifest = JSON.parse(before)
  const plugin = JSON.parse(await readFile(join(dist, 'next/package.json'), 'utf8'))

  assert.deepEqual(Object.keys(manifest.dependencies), ['next', 'react', 'react-dom'])
  assert.equal(manifest.devDependencies['@isox-sh/next'], plugin.version)
  const second = run('init', '@isox-sh/next', 'apps/admin')

  assert.equal(second.status, 0, second.stderr)
  assert.equal(await readFile(manifestPath, 'utf8'), before)
})

test('runs the workspace Next.js build and restores its production output from cache', async t => {
  const { root, project, run } = await fixture(t)

  await installFakeNext(root)
  const built = run('build', 'web', '--bundler=webpack')
  const { cwd, args } = cliInvocation(built)

  assert.equal(cwd, await realpath(project))
  assert.deepEqual(args, ['build', '--webpack'])
  await rm(join(project, '.next'), { recursive: true })
  await mkdir(join(project, '.next-dev'))
  await writeFile(join(project, '.next-dev/manifest.json'), '{}')
  const restored = run('build', 'web', '--bundler=webpack')

  assert.equal(restored.status, 0, restored.stderr)
  assert.match(restored.stdout, /Cache hit for web:build/)
  assert.equal(await readFile(join(project, '.next/BUILD_ID'), 'utf8'), 'built')
})

test('serves in both modes using the project installation and forwards server options', async t => {
  const { project, run } = await fixture(t)

  await installFakeNext(project)
  const dev = run('serve', 'web', '--hostname=127.0.0.1', '--port=0', '--bundler=turbopack')

  assert.deepEqual(cliInvocation(dev).args, ['dev', '--turbopack', '--hostname', '127.0.0.1', '--port', '0'])
  const production = () => run('serve', 'web', '--configuration=production', '--port=4200')
  const missingBuild = production()

  assert.equal(missingBuild.status, 1)
  assert.match(missingBuild.stderr, /BUILD_ID/)
  cliInvocation(run('build', 'web'))
  assert.deepEqual(cliInvocation(production()).args, ['start', '--port', '4200'])
})

test('reports invalid options and missing framework dependencies', async t => {
  const { run } = await fixture(t)

  for (const [args, error] of [
    [['serve', 'web', '--port=65536'], /port must be an integer/],
    [['serve', 'web', '--mode=invalid'], /serve mode must be/],
    [['build', 'web', '--bundler=invalid'], /bundler must be/],
    [['serve', 'web'], /Next\.js is missing/],
  ]) {
    const result = run(...args)

    assert.equal(result.status, 1)
    assert.match(result.stderr, error)
  }
})
