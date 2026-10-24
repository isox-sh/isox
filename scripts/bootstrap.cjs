const { spawnSync } = require('node:child_process')
const { readFileSync } = require('node:fs')
const { dirname, resolve } = require('node:path')

const root = resolve(__dirname, '..')
const compilerPackage = require.resolve('@typescript/native/package.json')
const compiler = require(compilerPackage)
const executable = resolve(dirname(compilerPackage), compiler.bin.tsc)

async function bootstrap() {
  // Seed the runtime and compiler executor before Isox can build itself.
  // Build options still come from each package's project.json.
  for (const name of ['core', 'js']) {
    const projectRoot = resolve(root, 'packages', name)
    const project = JSON.parse(readFileSync(resolve(projectRoot, 'project.json'), 'utf8'))
    const command = project.commands.build
    if (!['js:tsc', '@isox-sh/js:tsc'].includes(command.executor)) {
      throw new Error(`Bootstrap requires the TypeScript executor for ${name}.`)
    }
    const tsConfig = command.options?.tsConfig
    const configPath = tsConfig === undefined ? resolve(projectRoot, 'tsconfig.json') : resolve(root, tsConfig)
    const result = spawnSync(process.execPath, [executable, '--project', configPath], { cwd: root, stdio: 'inherit' })
    if (result.error) throw result.error
    if (result.status !== 0) throw new Error(`Bootstrap failed for ${name}.`)
  }

  const { parseWorkspace, resetWorkspace, runExecutor } = require('../packages/core/dist')
  await resetWorkspace(root)
  const workspace = await parseWorkspace(root)
  for (const name of ['core', 'js', 'cli']) {
    await runExecutor(workspace, name, 'build', root)
  }
}

bootstrap().catch(error => {
  console.error(error)
  process.exitCode = 1
})
