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

  t.onTestFinished(() => rm(root, {
    recursive: true,
    force: true
  }))
  const projectRoot = join(root, 'apps/demo project')
  const write = async (file, value) => {
    const path = join(root, file)

    await mkdir(dirname(path), { recursive: true })
    await writeFile(path, typeof value === 'string' ? value : JSON.stringify(value))
  }

  await write('isox.json', {})
  await write('apps/demo project/project.json', {
    name: 'demo',
    targets: { lint: { executor: 'eslint:lint' } }
  })
  await write('eslint.config.mjs', "export default [{ rules: { 'no-debugger': 'error', 'no-unused-vars': 'warn', semi: ['error', 'never'] } }]")
  await write('apps/demo project/index.js', 'export const value = 1\n')
  await write('unrelated/index.js', 'debugger\n')
  const link = join(root, 'node_modules/@isox-sh/eslint')

  await mkdir(dirname(link), { recursive: true })
  await symlink(resolve(import.meta.dirname, '../../../dist/eslint'), link, process.platform === 'win32' ? 'junction' : 'dir')
  const runCommand = (...args) => spawnSync(process.execPath, [cli, ...args], {
    cwd: projectRoot,
    encoding: 'utf8',
    timeout: 30_000,
    env: {
      ...process.env,
      ISOX_SKIP_CACHE: '',
      ISOX_PROGRESS: '0'
    },
  })
  const run = (...args) => runCommand('lint', 'demo', ...args)
  const configure = async options => {
    await write('apps/demo project/project.json', {
      name: 'demo',
      targets: {
        lint: {
          executor: '@isox-sh/eslint:lint',
          options
        }
      },
    })
    await rm(join(root, '.isox'), {
      recursive: true,
      force: true
    })
  }

  const context = {
    workspaceRoot: root,
    projectRoot,
    logger: createLogger({ level: LogLevels.silent })
  }

  return {
    root,
    projectRoot,
    write,
    run,
    runCommand,
    configure,
    context
  }
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
  await configure({
    lintFilePatterns: ['apps/demo project/index.js'],
    fix: true
  })
  const result = run()

  assert.equal(result.status, 0, result.stderr)
  assert.equal(await readFile(join(projectRoot, 'index.js'), 'utf8'), 'export const value = 1\n')
})

for (const args of [
  ['lint', 'demo'],
  ['run', 'demo:lint'],
  ['run-many', '--target=lint'],
  ['affected', '--target=lint', '--all'],
]) {
  test(`CLI --fix overrides configured options for ${args[0]}`, async t => {
    const { projectRoot, write, runCommand } = await fixture(t)

    await write('apps/demo project/project.json', {
      name: 'demo',
      targets: {
        lint: {
          executor: 'eslint:lint',
          options: { fix: true },
          defaultConfiguration: 'ci',
          configurations: { ci: { fix: false } }
        }
      }
    })
    await write('apps/demo project/index.js', 'export const value = 1;\n')
    assert.equal(runCommand(...args).status, 1)
    const result = runCommand(...args, '--fix')

    assert.equal(result.status, 0, result.stderr + result.stdout)
    assert.equal(await readFile(join(projectRoot, 'index.js'), 'utf8'), 'export const value = 1\n')
  })

  test(`CLI --no-fix disables configured fixes for ${args[0]}`, async t => {
    const { projectRoot, write, configure, runCommand } = await fixture(t)

    await configure({ fix: true })
    await write('apps/demo project/index.js', 'export const value = 1;\n')
    const result = runCommand(...args, '--no-fix')

    assert.equal(result.status, 1)
    assert.doesNotMatch(result.stderr, /Unknown option/)
    assert.equal(await readFile(join(projectRoot, 'index.js'), 'utf8'), 'export const value = 1;\n')
  })
}

for (const preTarget of ['prepare', 'lint']) {
  test(`multi-project --fix leaves ${preTarget} pre-target options unchanged`, async t => {
    const { projectRoot, write, runCommand } = await fixture(t)

    await write('apps/demo project/project.json', {
      name: 'demo',
      targets: {
        lint: { executor: 'eslint:lint' },
        prepare: { executor: 'eslint:lint' }
      }
    })
    await write('apps/demo project/index.js', 'export const value = 1;\n')
    const result = runCommand('run-many', '--target=lint', `--pre-targets=${preTarget}`, '--fix')

    assert.equal(result.status, 1)
    assert.equal(await readFile(join(projectRoot, 'index.js'), 'utf8'), 'export const value = 1;\n')
  })
}

test('uses workspace-relative configuration overrides', async t => {
  const { write, run } = await fixture(t)

  await write('config/custom lint.mjs', 'export default [{ rules: {} }]')
  await write('apps/demo project/index.js', 'debugger\n')
  await write('apps/demo project/project.json', {
    name: 'demo',
    targets: {
      lint: {
        executor: 'eslint:lint',
        options: { configFile: 'missing.mjs' },
        configurations: { ci: { configFile: 'config/custom lint.mjs' } },
      }
    },
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

  assert.deepEqual(await lint({}, {
    ...context,
    signal: AbortSignal.abort()
  }), { success: false })
})

test('caches terminal output without artifacts and invalidates on shared lint configuration changes', async t => {
  const { write, run } = await fixture(t)

  await write('isox.json', {
    targetDefaults: {
      'eslint:lint': {
        cache: true,
        inputs: ['{projectRoot}/**/*', '{workspaceRoot}/eslint.config.*']
      }
    }
  })
  await write('apps/demo project/index.js', 'const unused = 1\n')
  const first = run('--max-warnings=-1')

  assert.equal(first.status, 0, first.stderr + first.stdout)
  assert.match(first.stdout, /no-unused-vars/)
  assert.doesNotMatch(first.stdout, /Cache hit/)
  const cached = run('--max-warnings=-1')

  assert.equal(cached.status, 0, cached.stderr + cached.stdout)
  assert.match(cached.stdout, /Cache hit/)
  assert.match(cached.stdout, /no-unused-vars/)
  await write('eslint.config.mjs', "export default [{ rules: { 'no-unused-vars': 'error' } }]")
  const failed = run('--max-warnings=-1')

  assert.equal(failed.status, 1, failed.stderr + failed.stdout)
  assert.doesNotMatch(failed.stdout, /Cache hit/)
  assert.equal(run('--max-warnings=-1').status, 1)
})

test('cached lint targets still apply fixes each time source files need them', async t => {
  const { projectRoot, write, run } = await fixture(t)

  await write('isox.json', {
    targetDefaults: {
      'eslint:lint': {
        cache: true
      }
    }
  })
  for (let attempt = 0; attempt < 2; attempt++) {
    await write('apps/demo project/index.js', 'export const value = 1;\n')
    const result = run('--fix')

    assert.equal(result.status, 0, result.stderr + result.stdout)
    assert.doesNotMatch(result.stdout, /Cache hit/)
    assert.equal(await readFile(join(projectRoot, 'index.js'), 'utf8'), 'export const value = 1\n')
  }

})
