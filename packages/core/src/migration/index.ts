import { execFile } from 'node:child_process'
import { existsSync } from 'node:fs'
import { lstat, mkdtemp, readFile, rm } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import { delimiter, dirname, join } from 'node:path'
import { promisify } from 'node:util'

import { compare, gt, valid } from 'semver'

import { logger } from '../logger'
import { readJson } from '../utils/read-json'
import { resolvePackageJson } from '../utils/resolve-package-json'
import { writeJson } from '../utils/write-json'

import type { Logger } from '../logger'

export interface MigrationContext {
  workspaceRoot: string
  logger: Logger
}

/** Migration implementations should be idempotent so a reviewed plan can be rerun. */
export type Migration = (context: MigrationContext) => void | Promise<void>

export interface MigrationEntry {
  package: string
  name: string
  version: string
  description?: string
}

interface MigrationTask {
  entry: MigrationEntry
  implementation: Migration
}

interface MigrationDefinition {
  version: string
  implementation: string
  description?: string
}

export interface MigrationPackage {
  version: string
  migrations?: Record<string, MigrationDefinition>
}

interface PackageManifest {
  version?: string
  migrations?: string
  dependencies?: Record<string, string>
  devDependencies?: Record<string, string>
  optionalDependencies?: Record<string, string>
}

export type MigrationPackageResolver = (name: string, target: string, workspaceRoot: string) => Promise<MigrationPackage>

function record(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

function version(value: unknown): value is string {
  return typeof value === 'string' && valid(value) !== null
}

function definitions(value: unknown): Record<string, MigrationDefinition> {
  if (!record(value) || !record(value.migrations)) {
    throw new Error('Invalid migration registry: expected a migrations object.')
  }

  for (const [name, entry] of Object.entries(value.migrations)) {
    if (!record(entry) || !version(entry.version) || typeof entry.implementation !== 'string' || !entry.implementation.trim()
      || (entry.description !== undefined && typeof entry.description !== 'string')) {
      throw new Error(`Invalid migration definition: ${name}.`)
    }
  }

  return value.migrations as unknown as Record<string, MigrationDefinition>
}

const execute = promisify(execFile)

function npmCommand(): [string, string[]] {
  if (process.platform !== 'win32') {
    return ['npm', []]
  }

  // .cmd launchers cannot be passed to execFile; invoke npm's JS entry without a shell.
  for (const directory of [dirname(process.execPath), ...(process.env.PATH ?? '').split(delimiter)]) {
    const script = join(directory, 'node_modules', 'npm', 'bin', 'npm-cli.js')
    if (existsSync(script)) {
      return [process.execPath, [script]]
    }
  }

  throw new Error('Cannot locate npm. Install Node.js with npm and add it to PATH.')
}

/** npm supplies registry/auth configuration; package lifecycle scripts are never run while planning. */
export const resolveMigrationPackage: MigrationPackageResolver = async (name, target, workspaceRoot) => {
  const [npm, prefix] = npmCommand()
  const { stdout } = await execute(npm, [...prefix, 'view', `${name}@${target}`, '--json'], {
    cwd: workspaceRoot,
    maxBuffer: 10 * 1024 * 1024
  })
  const manifest = JSON.parse(stdout) as PackageManifest

  if (!version(manifest.version)) {
    throw new Error(`Registry did not return a single version for ${name}@${target}.`)
  }

  if (manifest.migrations === undefined) {
    return { version: manifest.version }
  }

  const temporary = await mkdtemp(join(tmpdir(), 'isox-migrate-'))

  try {
    await execute(npm, [...prefix, 'install', '--prefix', temporary, '--ignore-scripts', '--no-audit', '--no-fund', '--package-lock=false', `${name}@${manifest.version}`], {
      cwd: workspaceRoot,
      maxBuffer: 10 * 1024 * 1024
    })
    const packageRoot = join(temporary, 'node_modules', name)
    const installed = await readJson<PackageManifest>('package.json', { projectRoot: packageRoot })

    if (installed.version !== manifest.version || typeof installed.migrations !== 'string') {
      throw new Error(`Invalid migration metadata for ${name}.`)
    }

    return {
      version: manifest.version,
      migrations: definitions(await readJson(installed.migrations, { projectRoot: packageRoot }))
    }
  } finally {
    await rm(temporary, {
      recursive: true,
      force: true
    })
  }
}

/** Plan upgrades for registry dependencies in the workspace root package.json. */
export async function planMigrations(workspaceRoot: string, target: string, resolvePackage: MigrationPackageResolver = resolveMigrationPackage): Promise<void> {
  if (target !== 'latest' && !version(target)) {
    throw new Error('Migration target must be an exact semantic version or latest.')
  }

  const context = { projectRoot: workspaceRoot }

  // Never silently discard a plan that may contain unfinished migrations.
  try {
    await lstat(join(workspaceRoot, 'migrations.json'))
    throw new Error('migrations.json already exists. Finish or remove the existing plan first.')
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
      throw error
    }
  }

  const manifest = await readJson<PackageManifest>('package.json', context)
  const sections = ['dependencies', 'devDependencies', 'optionalDependencies'] as const
  const names = new Set(sections.flatMap(section => Object.keys(manifest[section] ?? {})).filter(name => name.startsWith('@isox-sh/')))
  const migrations: MigrationEntry[] = []
  let updated = 0
  // Resolve latest once: official packages are released together.
  let resolvedTarget = target

  for (const name of [...names].sort()) {
    const specs = sections.flatMap(section => manifest[section]?.[name] === undefined ? [] : [manifest[section]![name]])

    if (specs.some(spec => /^(workspace:|file:|link:)/.test(spec))) {
      logger.info(`Skipping local dependency ${name}.`)
      continue
    }

    if (specs.some(spec => !/^[~^]?\d+\.\d+\.\d+(?:-[\w.-]+)?(?:\+[\w.-]+)?$/.test(spec))) {
      throw new Error(`Unsupported dependency specifier for ${name}; use an exact, ^ or ~ version.`)
    }

    const installed = JSON.parse(await readFile(resolvePackageJson(name, workspaceRoot), 'utf8')) as PackageManifest

    if (!version(installed.version)) {
      throw new Error(`Cannot determine installed version of ${name}. Install dependencies first.`)
    }

    const next = await resolvePackage(name, resolvedTarget, workspaceRoot)

    if (!version(next.version) || (resolvedTarget !== 'latest' && compare(next.version, resolvedTarget) !== 0)) {
      throw new Error(`Unexpected target version for ${name}: ${next.version}.`)
    }

    resolvedTarget = next.version
    if (gt(installed.version, next.version)) {
      throw new Error(`Cannot migrate ${name} backwards from ${installed.version} to ${next.version}.`)
    }

    for (const [migrationName, entry] of Object.entries(definitions({ migrations: next.migrations ?? {} }))) {
      if (gt(entry.version, installed.version) && !gt(entry.version, next.version)) {
        migrations.push({
          package: name,
          name: migrationName,
          version: entry.version,
          ...(entry.description ? { description: entry.description } : {})
        })
      }
    }

    for (const section of sections) {
      const spec = manifest[section]?.[name]

      if (spec !== undefined) {
        manifest[section]![name] = `${spec.match(/^[~^]/)?.[0] ?? ''}${next.version}`
      }
    }

    updated++
  }

  if (!updated) {
    throw new Error('No registry @isox-sh dependencies found in the root package.json.')
  }

  migrations.sort((a, b) => compare(a.version, b.version) || a.package.localeCompare(b.package) || a.name.localeCompare(b.name))
  await writeJson('migrations.json', { migrations }, context, { overwrite: false })
  await writeJson('package.json', manifest, context)
  logger.success(`Prepared ${migrations.length} migration(s). Install dependencies with your package manager, then run isox migrate --run-migrations.`)
}

export async function runMigrations(workspaceRoot: string, file = 'migrations.json', ifExists = false): Promise<void> {
  let plan: unknown

  try {
    plan = await readJson(file, { projectRoot: workspaceRoot })
  } catch (error) {
    if (ifExists && (error as NodeJS.ErrnoException).code === 'ENOENT') {
      return
    }

    throw error
  }

  if (!record(plan) || !Array.isArray(plan.migrations)) {
    throw new Error('Invalid migration plan: expected a migrations array.')
  }

  // Validate the whole plan and resolve every implementation before running any code.
  const tasks: MigrationTask[] = []

  for (const entry of plan.migrations) {
    if (!record(entry) || typeof entry.package !== 'string' || !/^(?:@[a-z0-9._-]+\/)?[a-z0-9._-]+$/.test(entry.package)
      || typeof entry.name !== 'string' || !entry.name || !version(entry.version)) {
      throw new Error('Invalid migration plan entry.')
    }

    const packageFile = resolvePackageJson(entry.package, workspaceRoot)
    const packageRoot = dirname(packageFile)
    const manifest = JSON.parse(await readFile(packageFile, 'utf8')) as PackageManifest

    if (!version(manifest.version) || gt(entry.version, manifest.version)) {
      throw new Error(`Install the updated ${entry.package} before running migrations.`)
    }

    if (typeof manifest.migrations !== 'string') {
      throw new Error(`Package ${entry.package} does not declare migrations.`)
    }

    const registry = definitions(await readJson(manifest.migrations, { projectRoot: packageRoot }))
    const definition = Object.hasOwn(registry, entry.name) ? registry[entry.name] : undefined

    if (!definition || compare(definition.version, entry.version) !== 0) {
      throw new Error(`Migration ${entry.package}:${entry.name} does not match the installed registry.`)
    }

    const require = createRequire(join(packageRoot, manifest.migrations))
    const loaded = require(definition.implementation)
    const implementation = loaded?.default ?? loaded

    if (typeof implementation !== 'function') {
      throw new Error(`Migration ${entry.package}:${entry.name} does not export a function.`)
    }

    tasks.push({
      entry: entry as unknown as MigrationEntry,
      implementation
    })
  }

  const cacheDirectory = join(workspaceRoot, '.isox')
  const cacheEntry = await lstat(cacheDirectory).catch((error: NodeJS.ErrnoException) => {
    if (error.code !== 'ENOENT') {
      throw error
    }
  })

  if (cacheEntry?.isSymbolicLink()) {
    throw new Error('Cannot refresh workspace discovery through a symlinked .isox directory.')
  }

  try {
    for (const { entry, implementation } of tasks) {
      logger.info(`Running ${entry.package}:${entry.name}`)
      await implementation({
        workspaceRoot,
        logger
      })
    }
  } finally {
    // A failed migration may have already changed project configuration.
    await rm(join(cacheDirectory, 'workspace.json'), { force: true })
  }

  logger.success(`Completed ${tasks.length} migration(s).`)
}
