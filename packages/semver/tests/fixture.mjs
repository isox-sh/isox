import assert from 'node:assert/strict'
import { execFileSync, spawnSync } from 'node:child_process'
import { mkdir, mkdtemp, readFile, realpath, rm, symlink, writeFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'

const require = createRequire(import.meta.url)
const { createLogger } = require('../../../dist/core')
export const { default: version } = require('../../../dist/semver/executors/version/version.executor')
export const { default: github } = require('../../../dist/semver/executors/github/github.executor')
export const { planRelease } = require('../../../dist/semver/executors/version/plan')
export const { parseCommits, recommendedBump, releaseNotes } = require('../../../dist/semver/helpers/commits')
const cli = resolve(import.meta.dirname, '../../../dist/cli/index.js')

export async function fixture(t, initialVersion = '1.0.0') {
  const temporary = await mkdtemp(join(tmpdir(), 'isox release '))
  const root = await realpath(temporary)

  t.onTestFinished(() => rm(root, {
    recursive: true,
    force: true
  }))
  const git = (...args) => execFileSync('git', args, {
    cwd: root,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe']
  }).trimEnd()
  const write = async (file, value) => {
    const path = join(root, file)

    await mkdir(dirname(path), { recursive: true })
    await writeFile(path, typeof value === 'string' ? value : `${JSON.stringify(value, null, 2)}\n`)
  }

  const project = {
    name: 'demo',
    root: 'packages/demo',
    targets: { version: { executor: 'semver:version' } }
  }
  const messages = []
  const context = {
    workspaceRoot: root,
    projectRoot: join(root, project.root),
    projectName: 'demo',
    commandName: 'version',
    project,
    command: project.targets.version,
    workspace: { projects: { demo: project } },
    logger: createLogger({ reporters: [{ log: entry => messages.push(entry.args.join(' ')) }] }),
    verbose: false
  }

  await write('.gitignore', 'node_modules/\n.isox/\n')
  await write('isox.json', {})
  await write('packages/demo/package.json', {
    name: '@test/demo',
    version: initialVersion,
    dependencies: { external: '^1.0.0' }
  })
  await write('packages/demo/project.json', project)
  await write('packages/demo/index.js', 'export const initial = true\n')
  const link = join(root, 'node_modules/@isox-sh/semver')

  await mkdir(dirname(link), { recursive: true })
  await symlink(resolve(import.meta.dirname, '../../../dist/semver'), link, process.platform === 'win32' ? 'junction' : 'dir')
  git('init', '--initial-branch=main')
  git('config', 'user.name', 'Isox Test')
  git('config', 'user.email', 'isox-test@example.invalid')
  git('config', 'commit.gpgsign', 'false')
  git('config', 'tag.gpgsign', 'false')
  const commit = (message) => {
    git('add', '--all')
    git('commit', '-m', message)

    return git('rev-parse', 'HEAD')
  }

  commit('chore: Initial fixture')
  const run = (...args) => spawnSync(process.execPath, [cli, ...args], {
    cwd: context.projectRoot,
    encoding: 'utf8',
    timeout: 30_000
  })
  const packageJson = async () => JSON.parse(await readFile(join(context.projectRoot, 'package.json'), 'utf8'))
  const clean = () => assert.equal(git('status', '--porcelain'), '')

  return {
    root,
    git,
    write,
    commit,
    context,
    messages,
    run,
    packageJson,
    clean
  }
}
