import { createRequire } from 'node:module'

import { test } from 'vitest'

const require = createRequire(import.meta.url)
const __dirname = import.meta.dirname
const assert = require('node:assert/strict')
const { spawnSync } = require('node:child_process')
const { mkdtemp, mkdir, writeFile, readFile, rm, symlink } = require('node:fs/promises')
const { tmpdir } = require('node:os')
const { dirname, join, resolve } = require('node:path')

const { createLogger, LogLevels } = require('@isox-sh/core')
const { default: tsc } = require('../dist/commands/tsc/tsc.command')

async function fixture(t) {
  const root = await mkdtemp(join(tmpdir(), 'isox typescript '))
  t.onTestFinished(() => rm(root, { recursive: true, force: true }))
  const projectRoot = join(root, 'apps', 'demo app')
  await mkdir(projectRoot, { recursive: true })
  const write = (file, value) => writeFile(join(projectRoot, file), typeof value === 'string' ? value : JSON.stringify(value))
  const context = {
    workspaceRoot: root,
    projectRoot,
    logger: createLogger({ level: LogLevels.silent }),
  }
  await write('tsconfig.json', {
    compilerOptions: { target: 'ES2022', module: 'CommonJS', outDir: 'dist', declaration: true, noEmitOnError: true, types: [] },
    include: ['*.ts'],
  })
  await write('index.ts', 'export const answer: number = 42')
  return { root, projectRoot, write, context }
}

test('compiles the default project config and emits declarations with spaces in paths', async (t) => {
  const { projectRoot, context } = await fixture(t)
  assert.deepEqual(await tsc({}, context), { success: true })
  assert.match(await readFile(join(projectRoot, 'dist/index.js'), 'utf8'), /42/)
  assert.match(await readFile(join(projectRoot, 'dist/index.d.ts'), 'utf8'), /answer: number/)
})

test('returns failure for compiler diagnostics and missing configurations', async (t) => {
  const { write, context } = await fixture(t)
  await write('index.ts', 'export const answer: number = "wrong"')
  assert.deepEqual(await tsc({}, context), { success: false })
  assert.deepEqual(await tsc({ tsConfig: 'missing.json' }, context), { success: false })
})

test('rejects invalid config paths before spawning the compiler', async (t) => {
  const { context } = await fixture(t)
  for (const tsConfig of ['', ' ', 42, null, []]) {
    await assert.rejects(tsc({ tsConfig }, context), /tsConfig must be a non-empty string/)
  }
})

test('CLI loads the manifest and merges configurations using workspace-relative config paths', async (t) => {
  const { root, projectRoot, write } = await fixture(t)
  await write('tsconfig.production.json', {
    extends: './tsconfig.json', compilerOptions: { outDir: 'production' },
  })
  await writeFile(join(root, 'isox.json'), '{}')
  await write('project.json', {
    name: 'demo',
    commands: {
      build: {
        executor: '@isox-sh/js:tsc',
        options: { tsConfig: 'missing.json' },
        configurations: { production: { tsConfig: 'apps/demo app/tsconfig.production.json' } },
      },
    },
  })
  const link = join(root, 'node_modules/@isox-sh/js')
  await mkdir(dirname(link), { recursive: true })
  await symlink(resolve(__dirname, '..'), link, process.platform === 'win32' ? 'junction' : 'dir')
  const cli = resolve(__dirname, '../../cli/dist/index.js')
  const result = spawnSync(process.execPath, [cli, 'build', 'demo', '--prod'], { cwd: projectRoot, encoding: 'utf8' })
  assert.equal(result.status, 0, result.stderr)
  assert.match(await readFile(join(projectRoot, 'production/index.js'), 'utf8'), /42/)

  const failure = spawnSync(process.execPath, [cli, 'build', 'demo'], { cwd: projectRoot, encoding: 'utf8' })
  assert.equal(failure.status, 1)
  assert.match(failure.stderr, /Task failed for demo/)
})
