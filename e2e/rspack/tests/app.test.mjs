import assert from 'node:assert/strict'
import { rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'

import { createWorkspace } from '@isox-sh/e2e'
import { test } from 'vitest'

async function createApp(t) {
  const workspace = await createWorkspace({
    startDirectory: import.meta.dirname,
    plugins: {
      '@isox-sh/rspack': 'dist/rspack',
      '@isox-sh/js': 'dist/js'
    }
  })
  t.onTestFinished(workspace.cleanup)
  await workspace.runIsox(['init'])
  await workspace.runIsox(['init', '@isox-sh/rspack', 'apps/web'])

  return workspace
}

test('bundles a workspace library, restores the bundle, and rebuilds when the library changes', async t => {
  const { root, runIsox, runNode } = await createApp(t)
  await runIsox(['init', '@isox-sh/js', 'libs/shared', '--import-path=@demo/shared', '--linter=none'])
  const app = join(root, 'apps/web')
  const lib = join(root, 'libs/shared/src')
  await writeFile(join(app, 'src/index.js'), "import { greet } from '@demo/shared'\nconsole.log(greet('web'))")
  await writeFile(join(lib, 'index.ts'), "export { greet } from './greet.js'")

  for (const greeting of ['Hello', 'Welcome']) {
    await writeFile(join(lib, 'greet.ts'), `export const greet = (name: string): string => '${greeting} ' + name`)
    await runIsox(['build', 'web'])
    assert.equal((await runNode(['dist/main.js'], app)).stdout.trim(), `${greeting} web`)
  }

  await rm(join(app, 'dist'), { recursive: true })
  const restored = await runIsox(['build', 'web'])
  assert.match(restored.stdout, /Cache hit for web:build/)
  assert.equal((await runNode(['dist/main.js'], app)).stdout.trim(), 'Welcome web')
})

test('serves the generated app bundle over HTTP', async t => {
  const { root, runIsox, runNode } = await createApp(t)
  await writeFile(join(root, 'serve.config.mjs'), `
    import { writeFile } from 'node:fs/promises'
    import config from './apps/web/rspack.config.mjs'
    export default {
      ...config,
      devServer: {
        host: '127.0.0.1', hot: false, client: false, liveReload: false,
        async onListening(server) {
          try {
            const url = 'http://127.0.0.1:' + server.server.address().port + '/main.js'
            const response = await fetch(url, { signal: AbortSignal.timeout(10000) })
            if (!response.ok) throw new Error('GET /main.js returned ' + response.status)
            await writeFile('served.js', await response.text())
          } finally {
            await server.stop()
          }
        }
      }
    }
  `)
  await runIsox(['serve', 'web', '--port=0', '--config-file=serve.config.mjs'])
  assert.equal((await runNode(['apps/web/served.js'])).stdout.trim(), 'web')
})
