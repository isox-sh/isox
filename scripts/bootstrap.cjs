const { spawnSync } = require('node:child_process')
const { copyFileSync, existsSync, globSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } = require('node:fs')
const { dirname, resolve } = require('node:path')

const { linkDependency, recordSeedOwnership } = require('./bootstrap-files.cjs')

const root = resolve(__dirname, '..')
const seededFiles = new Map()
const packageNames = ['core', 'js', 'cli', 'eslint', 'vitest', 'nx', 'e2e']
const compilerPackage = require.resolve('@typescript/native/package.json')
const compiler = require(compilerPackage)
const executable = resolve(dirname(compilerPackage), compiler.bin.tsc)

// Source manifests point to root dist; seeded manifests resolve within their output package.
function rewriteOutputPaths(value, name) {
  const prefix = `../../dist/${name}/`
  if (typeof value === 'string' && value.startsWith(prefix)) {
    return `./${value.slice(prefix.length)}`
  }

  if (Array.isArray(value)) {
    return value.map(entry => rewriteOutputPaths(entry, name))
  }

  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).map(([key, entry]) => [key, rewriteOutputPaths(entry, name)]))
  }

  return value
}

function seed(name) {
  const source = resolve(root, 'packages', name)
  const output = resolve(root, 'dist', name)
  mkdirSync(output, { recursive: true })
  const files = []
  seededFiles.set(name, files)
  for (const file of ['package.json', 'executors.json']) {
    if (existsSync(resolve(source, file))) {
      const metadata = rewriteOutputPaths(JSON.parse(readFileSync(resolve(source, file), 'utf8')), name)
      if (file === 'package.json') {
        delete metadata.publishConfig.directory
        delete metadata.publishConfig.linkDirectory
      }
      files.push(resolve(output, file))
      writeFileSync(resolve(output, file), `${JSON.stringify(metadata, null, 2)}\n`)
    }
  }

  for (const [directory, pattern] of [['src', 'executors/**/*.schema.json'], ['.', 'schemas/**/*.json']]) {
    for (const file of globSync(pattern, { cwd: resolve(source, directory) })) {
      const destination = resolve(output, file)
      mkdirSync(dirname(destination), { recursive: true })
      copyFileSync(resolve(source, directory, file), destination)
      files.push(destination)
    }
  }

  const manifest = JSON.parse(readFileSync(resolve(source, 'package.json'), 'utf8'))
  // Compiled packages share dependency links outside their owned output directories.
  for (const dependency of Object.keys(manifest.dependencies ?? {})) {
    const installed = resolve(source, 'node_modules', dependency)
    if (!existsSync(installed)) {
      throw new Error(`Missing dependency ${dependency}; run pnpm install before bootstrap.`)
    }
    linkDependency(resolve(root, 'dist/node_modules', dependency), realpathSync(installed))
  }
  linkDependency(resolve(root, 'dist/node_modules', manifest.name), output)
}

function compileSeed(name) {
  const projectRoot = resolve(root, 'packages', name)
  const project = JSON.parse(readFileSync(resolve(projectRoot, 'project.json'), 'utf8'))
  const command = project.executors.build
  if (!['js:tsc', '@isox-sh/js:tsc'].includes(command.executor)) {
    throw new Error(`Bootstrap requires the TypeScript executor for ${name}.`)
  }

  const configPath = resolve(root, command.options?.tsConfig ?? `packages/${name}/tsconfig.json`)
  // The JS executor is not available yet to remap source aliases for isolated builds.
  const cache = resolve(root, '.isox')
  mkdirSync(cache, { recursive: true })
  const directory = mkdtempSync(resolve(cache, 'bootstrap-'))
  let result
  try {
    const seedConfig = resolve(directory, 'tsconfig.json')
    writeFileSync(seedConfig, JSON.stringify({
      extends: configPath,
      compilerOptions: {
        paths: name === 'js' ? { '@isox-sh/core': [resolve(root, 'dist/core/index.d.ts')] } : {},
      },
    }))
    result = spawnSync(process.execPath, [executable, '--project', seedConfig], { cwd: root, stdio: 'inherit' })
  } finally {
    rmSync(directory, { recursive: true, force: true })
  }
  if (result.error) {
    throw result.error
  }

  if (result.status !== 0) {
    throw new Error(`Bootstrap failed for ${name}.`)
  }
}

async function bootstrap() {
  for (const name of packageNames) {
    seed(name)
  }

  // Core and JS must exist before Isox can execute its own package builds.
  for (const name of ['core', 'js']) {
    compileSeed(name)
  }

  const { parseWorkspace, runExecutor } = require('../dist/core')
  // Refresh discovery without discarding output ownership or active build locks.
  const workspace = await parseWorkspace(root, { cache: false })
  await recordSeedOwnership(root, seededFiles)

  for (const name of ['core', 'js', 'cli', 'eslint', 'vitest', 'nx', 'e2e-plugin']) {
    await runExecutor(workspace, name, 'build', root)
  }
}

bootstrap().catch(error => {
  console.error(error)
  process.exitCode = 1
})
