import { execFileSync, spawnSync } from 'node:child_process'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'

export const cliPath = resolve(import.meta.dirname, '../../../../dist/cli/index.js')

export async function affectedFixture(t) {
  const root = await mkdtemp(join(tmpdir(), 'isox-affected-cli-'))
  t.onTestFinished(() => rm(root, { recursive: true, force: true }))
  const write = async (file, value) => {
    await mkdir(dirname(join(root, file)), { recursive: true })
    await writeFile(join(root, file), typeof value === 'string' ? value : JSON.stringify(value))
  }
  const git = (...args) => execFileSync('git', args, { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim()
  const commit = () => {
    git('add', '.')
    git('-c', 'commit.gpgsign=false', '-c', 'user.name=Isox test', '-c', 'user.email=test@example.invalid', 'commit', '-m', 'fixture')
    return git('rev-parse', 'HEAD')
  }
  const run = (...args) => spawnSync(process.execPath, [cliPath, ...args], { cwd: root, encoding: 'utf8' })
  git('init', '--initial-branch=main')
  await write('.gitignore', 'node_modules/\n.isox/\nevents.log\n')
  await write('isox.json', {})
  await write('node_modules/@fixture/plugin/package.json', { name: '@fixture/plugin', executors: './executors.json' })
  await write('node_modules/@fixture/plugin/executors.json', { executors: { record: { implementation: './record.cjs' } } })
  await write('node_modules/@fixture/plugin/record.cjs', `
const fs = require('node:fs')
module.exports = async (options, context) => {
  const event = phase => fs.appendFileSync('events.log', JSON.stringify({ phase, project: context.projectName, target: context.commandName, config: context.configurationName, marker: options.marker }) + '\\n')
  event('start')
  await new Promise(resolve => setTimeout(resolve, options.delay ?? 200))
  event('end')
  return { success: !options.fail }
}
`)
  const project = async (name, extra = {}) => {
    const command = { executor: '@fixture/plugin:record', options: { marker: 'base' }, configurations: { production: { marker: 'prod' } } }
    await write(`packages/${name}/project.json`, { name, executors: { build: command, prepare: command, finish: command }, ...extra })
  }
  await project('lib')
  await project('app', { dependencies: ['lib'] })
  await project('other')
  const base = commit()
  git('update-ref', 'refs/remotes/origin/main', base)
  return { root, write, git, commit, run, project, base }
}
