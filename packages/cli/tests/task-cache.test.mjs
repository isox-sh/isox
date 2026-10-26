import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { mkdir, mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'

import { test } from 'vitest'

const cli = resolve(import.meta.dirname, '../../../dist/cli/index.js')

test('CLI caches child output, forwards bypass to run-many, and reset clears every cache', async t => {
  const root = await mkdtemp(join(tmpdir(), 'isox-cli-task-cache-'))

  t.onTestFinished(() => rm(root, {
    recursive: true,
    force: true
  }))
  const write = async (file, value) => {
    await mkdir(dirname(join(root, file)), { recursive: true })
    await writeFile(join(root, file), typeof value === 'string' ? value : JSON.stringify(value))
  }

  const run = (...args) => {
    const result = spawnSync(process.execPath, [cli, ...args], {
      cwd: root,
      encoding: 'utf8',
      env: {
        ...process.env,
        ISOX_SKIP_CACHE: '',
        ISOX_PROGRESS: '0'
      }
    })

    assert.equal(result.status, 0, result.stderr + result.stdout)

    return result.stdout
  }

  await write('isox.json', {})
  await write('apps/demo/project.json', {
    name: 'demo',
    targets: {
      build: {
        executor: 'core:run-command',
        cache: true,
        outputs: ['dist/demo'],
        inputs: ['{projectRoot}/**/*', 'build.cjs'],
        options: { command: 'node build.cjs' },
      }
    }
  })
  await write('build.cjs', String.raw`
    const fs = require('node:fs')
    fs.appendFileSync('runs', 'run\n')
    fs.mkdirSync('dist/demo', { recursive: true })
    fs.writeFileSync('dist/demo/file', 'built')
    process.stdout.write('stdout from child\n')
    process.stderr.write('stderr from child\n')
  `)
  assert.match(run('build', 'demo'), /stdout from child/)
  await rm(join(root, 'dist'), { recursive: true })
  const restored = run('run', 'demo:build')

  assert.match(restored, /Cache hit/)
  assert.match(restored, /stdout from child/)
  assert.ok(restored.indexOf('Cache hit') < restored.indexOf('stdout from child'))
  assert.doesNotMatch(restored, /Cache miss/)
  assert.equal(await readFile(join(root, 'dist/demo/file'), 'utf8'), 'built')
  assert.equal(await readFile(join(root, 'runs'), 'utf8'), 'run\n')
  run('run-many', '--target=build', '--projects=demo', '--skip-cache')
  assert.equal(await readFile(join(root, 'runs'), 'utf8'), 'run\nrun\n')
  assert.match(run('run-many', '--target=build', '--projects=demo'), /Cache hit/)
  run('affected', '--all', '--target=build', '--skip-cache')
  assert.equal(await readFile(join(root, 'runs'), 'utf8'), 'run\nrun\nrun\n')
  const directory = join(root, '.isox/tasks')
  const entries = (await readdir(directory)).filter(name => /^[a-f0-9]{64}$/.test(name))
  const entry = JSON.parse(await readFile(join(directory, entries[0], 'entry.json'), 'utf8'))
  const logs = entry.logs.map(chunk => Buffer.from(chunk.data, 'base64').toString()).join('')

  assert.match(logs, /stdout from child/)
  assert.match(logs, /stderr from child/)
  run('reset')
  await assert.rejects(readdir(join(root, '.isox')), { code: 'ENOENT' })
  assert.doesNotMatch(run('build', 'demo'), /Cache hit/)
})
