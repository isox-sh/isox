import assert from 'node:assert/strict'
import { spawn, spawnSync } from 'node:child_process'
import { once } from 'node:events'
import { access, readFile, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { setTimeout as sleep } from 'node:timers/promises'

import { createWorkspace } from '@isox-sh/e2e'
import { test, vi } from 'vitest'

async function requestPage(root, args) {
  const cliRoot = join(root, 'node_modules/@isox-sh/cli')
  const { bin } = JSON.parse(await readFile(join(cliRoot, 'package.json'), 'utf8'))
  const server = spawn(process.execPath, [
    join(cliRoot, bin.isox), 'serve', 'web', '--hostname=127.0.0.1', '--port=0', ...args
  ], { cwd: root })
  let output = ''
  let stopped = false
  const closed = once(server, 'close').catch(error => {
    output += error.message
  }).finally(() => {
    stopped = true
  })

  for (const stream of [server.stdout, server.stderr]) {
    stream.on('data', chunk => {
      output += chunk
    })
  }

  try {
    const signal = AbortSignal.timeout(20_000)
    let port

    while (!port) {
      assert.equal(stopped, false, 'Server stopped before accepting requests.')
      if (output.includes('Ready')) {
        port = output.match(/Local:\s+http:\/\/127\.0\.0\.1:(\d+)/)?.[1]
      }

      if (!port) {
        await sleep(50, undefined, { signal })
      }
    }

    const response = await fetch(`http://127.0.0.1:${port}`, { signal })

    assert.equal(response.status, 200)

    return await response.text()
  } catch (error) {
    throw new Error(`Next.js serve failed.\n${output}`, { cause: error })
  } finally {
    if (server.pid && server.exitCode === null && server.signalCode === null) {
      if (process.platform === 'win32') {
        spawnSync('taskkill', ['/pid', String(server.pid), '/T', '/F'])
      } else {
        server.kill('SIGTERM')
      }
    }

    await closed
  }
}

test('scaffolds and serves a Next.js app in development and from a cached production build', async t => {
  vi.stubEnv('NEXT_TELEMETRY_DISABLED', '1')
  vi.stubEnv('ISOX_SKIP_CACHE', '')
  t.onTestFinished(() => vi.unstubAllEnvs())

  const { root, runIsox, cleanup } = await createWorkspace({
    startDirectory: import.meta.dirname,
    plugins: {
      '@isox-sh/next': 'dist/next',
      next: 'e2e/next/node_modules/next',
      react: 'e2e/next/node_modules/react',
      'react-dom': 'e2e/next/node_modules/react-dom'
    }
  })

  t.onTestFinished(cleanup)
  await runIsox(['init'])
  await runIsox(['init', '@isox-sh/next', 'apps/web'])

  const app = join(root, 'apps/web')
  const heading = /<h1>web<\/h1>/

  assert.match(await requestPage(root, []), heading)
  await access(join(app, '.next-dev'))

  await runIsox(['build', 'web'])
  const output = join(app, '.next')
  const buildId = await readFile(join(output, 'BUILD_ID'), 'utf8')

  await rm(output, { recursive: true })
  const restored = await runIsox(['build', 'web'])

  assert.match(restored.stdout, /Cache hit for web:build/)
  assert.equal(await readFile(join(output, 'BUILD_ID'), 'utf8'), buildId)
  assert.match(await requestPage(root, ['--configuration=production']), heading)
})
