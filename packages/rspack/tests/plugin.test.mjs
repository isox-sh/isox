import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { mkdir, mkdtemp, readFile, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'

import { test } from 'vitest'

const dist = resolve(import.meta.dirname, '../../../dist')

async function fixture(t) {
  const root = await mkdtemp(join(tmpdir(), 'isox rspack '))
  const project = join(root, 'apps/web')
  const projectFile = join(project, 'project.json')
  t.onTestFinished(() => rm(root, {
    recursive: true,
    force: true
  }))
  await mkdir(join(root, 'node_modules/@isox-sh'), { recursive: true })
  await symlink(join(dist, 'rspack'), join(root, 'node_modules/@isox-sh/rspack'), 'junction')
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

  return {
    root,
    project,
    projectFile,
    run
  }
}

test('initializes a project with a working JavaScript entry and build and serve targets', async t => {
  const { root, project, projectFile, run } = await fixture(t)
  const initialized = run('init', '@isox-sh/rspack', 'apps/web')

  assert.equal(initialized.status, 0, initialized.stderr)
  assert.deepEqual(JSON.parse(await readFile(projectFile, 'utf8')), {
    name: 'web',
    targets: {
      build: {
        executor: 'rspack:build',
        cache: true,
        outputs: ['{projectRoot}/dist']
      },
      serve: { executor: 'rspack:serve' }
    }
  })
  const plugin = JSON.parse(await readFile(join(dist, 'rspack/package.json'), 'utf8'))
  assert.deepEqual(JSON.parse(await readFile(join(root, 'package.json'), 'utf8')).devDependencies, {
    '@isox-sh/rspack': plugin.version,
    '@rspack/core': plugin.dependencies['@rspack/core'],
    '@rspack/cli': plugin.dependencies['@rspack/cli'],
    '@rspack/dev-server': plugin.dependencies['@rspack/dev-server']
  })
  const built = run('build', 'web')

  assert.equal(built.status, 0, built.stderr)
  await rm(join(project, 'dist'), { recursive: true })
  const restored = run('build', 'web')

  assert.equal(restored.status, 0, restored.stderr)
  assert.match(restored.stdout, /Cache hit/)
  const bundle = spawnSync(process.execPath, [join(project, 'dist/main.js')], { encoding: 'utf8' })

  assert.equal(bundle.status, 0, bundle.stderr)
  assert.equal(bundle.stdout.trim(), 'web')
})

test('two apps share one workspace dependency manifest', async t => {
  const { root, run } = await fixture(t)
  const manifest = join(root, 'package.json')
  const web = run('init', '@isox-sh/rspack', 'apps/web')
  assert.equal(web.status, 0, web.stderr)
  const afterFirstApp = await readFile(manifest, 'utf8')
  const admin = run('init', '@isox-sh/rspack', 'apps/admin')
  assert.equal(admin.status, 0, admin.stderr)

  assert.equal(await readFile(manifest, 'utf8'), afterFirstApp)
  for (const app of ['web', 'admin']) {
    await assert.rejects(readFile(join(root, 'apps', app, 'package.json')), { code: 'ENOENT' })
  }
})

test('initializing an existing directory preserves its files', async t => {
  const { project, projectFile, run } = await fixture(t)

  await mkdir(project, { recursive: true })
  await writeFile(projectFile, '{"name":"existing"}')
  const failed = run('init', '@isox-sh/rspack', 'apps/web')

  assert.equal(failed.status, 1)
  assert.match(failed.stderr, /already exists/)
  assert.equal(await readFile(projectFile, 'utf8'), '{"name":"existing"}')
})

test('forwards workspace-relative config overrides and Rspack failures', async t => {
  const { root, project, run } = await fixture(t)
  const initialized = run('init', '@isox-sh/rspack', 'apps/web')

  assert.equal(initialized.status, 0, initialized.stderr)
  await writeFile(join(project, 'src/index.js'), 'console.log("bundled web project")')
  await writeFile(join(root, 'shared config.mjs'), "export default { output: { filename: 'custom.js' } }")
  const built = run('build', 'web', '--config-file=shared config.mjs', '--mode=development')

  assert.equal(built.status, 0, built.stderr)
  assert.match(await readFile(join(project, 'dist/custom.js'), 'utf8'), /bundled web project/)
  await writeFile(join(project, 'src/index.js'), "import './missing.js'")
  const failedBuild = run('build', 'web')

  assert.equal(failedBuild.status, 1)
  assert.match(failedBuild.stdout + failedBuild.stderr, /missing.js/)
  const failedServe = run('serve', 'web', '--config-file=missing.mjs')

  assert.equal(failedServe.status, 1)
  assert.match(failedServe.stderr, /missing.mjs/)
})

test('bundles a TypeScript library added later by its workspace alias and rebuilds when it changes', async t => {
  const { root, project, run } = await fixture(t)
  await symlink(join(dist, 'js'), join(root, 'node_modules/@isox-sh/js'), 'junction')
  const app = run('init', '@isox-sh/rspack', 'apps/web')
  assert.equal(app.status, 0, app.stderr)
  const lib = run('init', '@isox-sh/js', 'libs/shared', '--import-path=@demo/shared', '--linter=none')
  assert.equal(lib.status, 0, lib.stderr)

  await writeFile(join(project, 'src/index.js'), "import { greet } from '@demo/shared'\nconsole.log(greet('web'))")
  const libRoot = join(root, 'libs/shared/src')
  await writeFile(join(libRoot, 'index.ts'), "export { greet } from './greet.js'")
  for (const greeting of ['Hello', 'Welcome']) {
    await writeFile(join(libRoot, 'greet.ts'), `export const greet = (name: string): string => '${greeting} ' + name`)
    const built = run('build', 'web')

    assert.equal(built.status, 0, built.stderr + built.stdout)
    const bundle = spawnSync(process.execPath, [join(project, 'dist/main.js')], { encoding: 'utf8' })

    assert.equal(bundle.status, 0, bundle.stderr)
    assert.equal(bundle.stdout.trim(), `${greeting} web`)
  }
})
