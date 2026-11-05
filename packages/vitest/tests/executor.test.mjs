import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { mkdir, mkdtemp, readFile, rm, symlink, writeFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'

import { test } from 'vitest'

const require = createRequire(import.meta.url)
const { default: runVitest } = require('../../../dist/vitest/executors/test/test.executor')
const { createLogger, LogLevels } = require('@isox-sh/core')
const cli = resolve(import.meta.dirname, '../../../dist/cli/index.js')

async function fixture(t) {
  const root = await mkdtemp(join(tmpdir(), 'isox vitest '))

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
    targets: { test: { executor: 'vitest:test' } }
  })
  await write('apps/demo project/tests/example.test.mjs', "import { test, expect } from 'vitest'\ntest('passes', () => expect(1).toBe(1))")
  await write('unrelated/project.json', { name: 'sibling' })
  await write('unrelated/failure.test.mjs', "throw new Error('must not scan sibling projects')")
  for (const [name, target] of [
    ['vitest', dirname(require.resolve('vitest/package.json'))],
    ['@isox-sh/vitest', resolve(import.meta.dirname, '../../../dist/vitest')],
  ]) {
    const link = join(root, 'node_modules', name)

    await mkdir(dirname(link), { recursive: true })
    await symlink(target, link, process.platform === 'win32' ? 'junction' : 'dir')
  }

  const run = (...args) => spawnSync(process.execPath, [cli, 'test', 'demo', ...args], {
    cwd: projectRoot,
    encoding: 'utf8',
    timeout: 30_000,
    env: {
      ...process.env,
      ISOX_SKIP_CACHE: '',
      ISOX_PROGRESS: '0'
    },
  })
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
    context
  }
}

test('runs only the selected project once and prefers the executor over the Vitest package', async t => {
  const { run } = await fixture(t)
  const result = run()

  assert.equal(result.status, 0, result.stderr)
  assert.match(result.stdout, /1 passed/)
  assert.match(result.stdout, /Successfully completed vitest:test/)
})

test('propagates failing tests and empty suites as CLI failures', async t => {
  const { projectRoot, write, run } = await fixture(t)

  await write('apps/demo project/tests/example.test.mjs', "import { test, expect } from 'vitest'\ntest('fails', () => expect(1).toBe(2))")
  const failed = run()

  assert.equal(failed.status, 1, failed.stderr)
  assert.match(failed.stderr, /Task failed for demo/)

  await rm(join(projectRoot, 'tests'), { recursive: true })
  const empty = run()

  assert.equal(empty.status, 1, empty.stderr)
  assert.match(empty.stderr + empty.stdout, /No test files found/)
})

test('supports scoped executors and configuration overrides with workspace-relative config paths', async t => {
  const { root, write, run } = await fixture(t)

  await write('apps/demo project/project.json', {
    name: 'demo',
    targets: {
      test: {
        executor: '@isox-sh/vitest:test',
        options: { configFile: 'missing.config.mjs' },
        configurations: { ci: { configFile: 'config/vitest ci.mjs' } },
      },
    },
  })
  await write('config/vitest ci.mjs', "export default { test: { include: ['tests/example.test.mjs'] } }")
  await write('apps/demo project/tests/excluded.test.mjs', "throw new Error('must use configured include')")
  const configured = run('--config=ci')

  assert.equal(configured.status, 0, configured.stderr)
  assert.match(configured.stdout, /1 passed/)
  const missing = run()

  assert.equal(missing.status, 1, missing.stderr)
  assert.match(missing.stderr, /Task failed for demo/)
  assert.ok(missing.stderr.includes(join(root, 'missing.config.mjs')))
})

test('rejects invalid options and process launch failures', async t => {
  const { context } = await fixture(t)

  for (const configFile of ['', ' ', null, 42, []]) {
    await assert.rejects(runVitest({ configFile }, context), /configFile must be a non-empty string/)
  }

  await assert.rejects(runVitest({}, {
    ...context,
    projectRoot: join(context.projectRoot, 'missing')
  }), { code: 'ENOENT' })
})

test('replays test logs without rerunning tests or requiring artifact outputs', async t => {
  const { root, write, run } = await fixture(t)

  await write('isox.json', {
    targetDefaults: {
      'vitest:test': {
        cache: true
      }
    }
  })
  await write('apps/demo project/tests/example.test.mjs', `
    import { appendFileSync } from 'node:fs'
    import { test } from 'vitest'
    test('records a run', () => {
      appendFileSync(${JSON.stringify(join(root, 'runs'))}, 'run\\n')
      process.stdout.write('stdout from test\\n')
      process.stderr.write('stderr from test\\n')
    })
  `)
  const first = run()

  assert.equal(first.status, 0, first.stderr + first.stdout)
  assert.doesNotMatch(first.stdout, /Cache hit/)
  const cached = run()

  assert.equal(cached.status, 0, cached.stderr + cached.stdout)
  assert.match(cached.stdout, /Cache hit/)
  assert.match(cached.stdout, /stdout from test/)
  assert.match(cached.stderr, /stderr from test/)
  assert.equal(await readFile(join(root, 'runs'), 'utf8'), 'run\n')
  await write('apps/demo project/tests/example.test.mjs', "import { test, expect } from 'vitest'\ntest('changed', () => expect(1).toBe(2))")
  const failed = run()

  assert.equal(failed.status, 1, failed.stderr + failed.stdout)
  assert.doesNotMatch(failed.stdout, /Cache hit/)
  assert.equal(run().status, 1)
})
