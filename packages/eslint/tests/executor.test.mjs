import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { mkdir, mkdtemp, readFile, rm, symlink, writeFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'

import { test } from 'vitest'

const require = createRequire(import.meta.url)
const { default: lint } = require('../../../dist/eslint/executors/lint/lint.executor')
const { createLogger, LogLevels } = require('@isox-sh/core')
const cli = resolve(import.meta.dirname, '../../../dist/cli/index.js')

async function fixture(t) {
  const root = await mkdtemp(join(tmpdir(), 'isox eslint '))
  t.onTestFinished(() => rm(root, { recursive: true, force: true }))
  const projectRoot = join(root, 'apps/demo project')
  const write = async (file, value) => {
    const path = join(root, file)
    await mkdir(dirname(path), { recursive: true })
    await writeFile(path, typeof value === 'string' ? value : JSON.stringify(value))
  }
  await write('isox.json', {})
  await write('apps/demo project/project.json', { name: 'demo', targets: { lint: { executor: 'eslint:lint' } } })
  await write('eslint.config.mjs', "export default [{ rules: { 'no-debugger': 'error', 'no-unused-vars': 'warn', semi: ['error', 'never'] } }]")
  await write('apps/demo project/index.js', 'export const value = 1\n')
  await write('unrelated/index.js', 'debugger\n')
  const link = join(root, 'node_modules/@isox-sh/eslint')
  await mkdir(dirname(link), { recursive: true })
  await symlink(resolve(import.meta.dirname, '../../../dist/eslint'), link, process.platform === 'win32' ? 'junction' : 'dir')
  const run = (...args) => spawnSync(process.execPath, [cli, 'lint', 'demo', ...args], {
    cwd: projectRoot, encoding: 'utf8', timeout: 30_000,
  })
  const configure = async options => {
    await write('apps/demo project/project.json', {
      name: 'demo', targets: { lint: { executor: '@isox-sh/eslint:lint', options } },
    })
    await rm(join(root, '.isox'), { recursive: true, force: true })
  }
  const context = { workspaceRoot: root, projectRoot, logger: createLogger({ level: LogLevels.silent }) }
  return { root, projectRoot, write, run, configure, context }
}

test('lints only the selected project and supports the first-party shorthand', async t => {
  const { run } = await fixture(t)
  const result = run()
  assert.equal(result.status, 0, result.stderr)
  assert.match(result.stdout, /Successfully completed eslint:lint/)
})

test('fails on lint errors, warnings by default, and unmatched patterns', async t => {
  const { write, run, configure } = await fixture(t)
  await write('apps/demo project/index.js', 'debugger\n')
  assert.equal(run().status, 1)
  await write('apps/demo project/index.js', 'const unused = 1\n')
  assert.equal(run().status, 1)
  await configure({ maxWarnings: -1 })
  const warnings = run()
  assert.equal(warnings.status, 0, warnings.stderr + warnings.stdout)
  await configure({ lintFilePatterns: ['missing/**/*.js'] })
  assert.equal(run().status, 1)
})

test('supports scoped names, workspace-relative globs, and fixes', async t => {
  const { projectRoot, write, run, configure } = await fixture(t)
  await write('apps/demo project/index.js', 'export const value = 1;\n')
  await write('apps/demo project/excluded.js', 'debugger\n')
  await configure({ lintFilePatterns: ['apps/demo project/index.js'], fix: true })
  const result = run()
  assert.equal(result.status, 0, result.stderr)
  assert.equal(await readFile(join(projectRoot, 'index.js'), 'utf8'), 'export const value = 1\n')
})

test('uses workspace-relative configuration overrides', async t => {
  const { write, run } = await fixture(t)
  await write('config/custom lint.mjs', 'export default [{ rules: {} }]')
  await write('apps/demo project/index.js', 'debugger\n')
  await write('apps/demo project/project.json', {
    name: 'demo', targets: { lint: {
      executor: 'eslint:lint', options: { configFile: 'missing.mjs' },
      configurations: { ci: { configFile: 'config/custom lint.mjs' } },
    } },
  })
  assert.equal(run().status, 1)
  const configured = run('--config=ci')
  assert.equal(configured.status, 0, configured.stderr)
})

test('validates options and respects cancellation', async t => {
  const { context } = await fixture(t)
  for (const options of [null, [], { unknown: true }, { lintFilePatterns: [] }, { lintFilePatterns: [''] },
    { lintFilePatterns: 'index.js' }, { configFile: ' ' }, { fix: 'true' }, { maxWarnings: -2 }, { maxWarnings: 0.5 }]) {
    await assert.rejects(lint(options, context), /ESLint/)
  }
  assert.deepEqual(await lint({}, { ...context, signal: AbortSignal.abort() }), { success: false })
})
