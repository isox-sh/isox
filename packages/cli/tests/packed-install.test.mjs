import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { mkdir, mkdtemp, readFile, realpath, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'

import { test } from 'vitest'

// These checks install registry dependencies. CI opts in after bootstrapping.
test.skipIf(process.env.ISOX_TEST_PACKAGES !== '1')('packed CLI and core work through local and global npm installs outside the checkout', async t => {
  const root = await realpath(await mkdtemp(join(tmpdir(), 'isox packed ')))
  const repository = resolve(import.meta.dirname, '../../..')

  t.onTestFinished(() => rm(root, {
    recursive: true,
    force: true
  }))
  const env = {
    ...process.env,
    npm_config_cache: join(root, 'cache'),
    NODE_PATH: ''
  }
  const run = (command, args, cwd = root) => {
    // cmd shims need a shell on Windows; all arguments here are fixed flags or fixture paths.
    const quote = value => `"${value}"`
    const windows = process.platform === 'win32'
    const result = spawnSync(windows ? quote(command) : command, windows ? args.map(quote) : args, {
      cwd,
      env,
      encoding: 'utf8',
      timeout: 120_000,
      shell: windows,
      maxBuffer: 10 * 1024 * 1024,
    })

    assert.equal(result.status, 0, `${command} ${args.join(' ')}\n${result.error ?? ''}\n${result.stdout}\n${result.stderr}`)

    return result.stdout
  }

  const tarballs = ['core', 'cli'].map(name => {
    const [packed] = JSON.parse(run('npm', ['pack', '--json', '--ignore-scripts', '--pack-destination', root], join(repository, 'dist', name)))

    return join(root, packed.filename)
  })
  const version = JSON.parse(await readFile(join(repository, 'dist/cli/package.json'), 'utf8')).version

  for (const global of [false, true]) {
    const directory = join(root, global ? 'global' : 'local')
    const workspace = join(directory, 'workspace')
    const prefix = join(directory, 'installation')

    await mkdir(workspace, { recursive: true })
    await mkdir(prefix, { recursive: true })
    await writeFile(join(prefix, 'package.json'), JSON.stringify({ private: true }))
    run('npm', ['install', '--ignore-scripts', '--no-audit', '--no-fund', ...(global ? ['--global'] : []), '--prefix', prefix, ...tarballs])
    const modules = join(prefix, global && process.platform !== 'win32' ? 'lib/node_modules' : 'node_modules')
    const binary = global
      ? join(prefix, process.platform === 'win32' ? 'isox.cmd' : 'bin/isox')
      : join(modules, '.bin', process.platform === 'win32' ? 'isox.cmd' : 'isox')

    assert.ok(!(await realpath(join(modules, '@isox-sh/core'))).startsWith(repository))
    assert.match(run(binary, ['--help'], workspace), /isox/)
    run(binary, ['init'], workspace)
    assert.equal(JSON.parse(await readFile(join(workspace, 'isox.json'), 'utf8')).version, version)
    await writeFile(join(workspace, 'project.json'), JSON.stringify({
      name: 'demo',
      targets: {
        check: {
          executor: 'core:run-command',
          options: { command: 'node check.cjs' }
        }
      },
    }))
    await writeFile(join(workspace, 'check.cjs'), "require('node:fs').writeFileSync('result', 'packed executor works')")
    run(binary, ['check', 'demo'], workspace)
    assert.equal(await readFile(join(workspace, 'result'), 'utf8'), 'packed executor works')
    run(binary, ['reset'], workspace)
    await assert.rejects(readFile(join(workspace, '.isox/workspace.json')), { code: 'ENOENT' })
  }
}, 300_000)
