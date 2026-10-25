import { execFile } from 'node:child_process'
import { mkdir, mkdtemp, realpath, rm, symlink } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { dirname, join, resolve } from 'node:path'
import { promisify } from 'node:util'

import { findWorkspaceRoot, readJson, writeJson } from '@isox-sh/core'

import type { CommandOutput, CreateWorkspaceOptions, TestWorkspace } from './workspace.types'

const execute = promisify(execFile)
const packageRequire = createRequire(__filename)

interface PackageManifest {
  name: string
  version: string
  bin?: string | Record<string, string>
}

async function readPackage(directory: string, expectedName: string): Promise<PackageManifest> {
  const manifest = await readJson<PackageManifest>('package.json', { projectRoot: directory })
  if (manifest?.name !== expectedName) {
    throw new Error(`Expected package ${expectedName} in ${directory}, found ${manifest?.name ?? 'no package name'}.`)
  }

  return manifest
}

/** Create an uninitialized fixture using built local packages, without invoking a package manager. */
export async function createWorkspace(options: CreateWorkspaceOptions = {}): Promise<TestWorkspace> {
  const workspaceRoot = await findWorkspaceRoot(options.startDirectory)
  const maxBuffer = options.maxBuffer ?? 16 * 1024 * 1024
  if (!Number.isSafeInteger(maxBuffer) || maxBuffer <= 0) {
    throw new Error('E2E maxBuffer must be a positive integer number of bytes.')
  }
  const timeout = options.timeout ?? 30_000
  if (!Number.isFinite(timeout) || timeout <= 0) {
    throw new Error('E2E timeout must be a positive number of milliseconds.')
  }

  const cliRoot = await realpath(options.cliDirectory === undefined
    ? dirname(packageRequire.resolve('isox/package.json'))
    : resolve(workspaceRoot, options.cliDirectory))
  const cliPackage = await readPackage(cliRoot, 'isox')
  const bin = typeof cliPackage.bin === 'string' ? cliPackage.bin : cliPackage.bin?.isox
  if (typeof bin !== 'string' || !bin || typeof cliPackage.version !== 'string') {
    throw new Error(`Invalid CLI package in ${cliRoot}: expected a version and an isox binary.`)
  }

  const cli = resolve(cliRoot, bin)
  const coreRoot = dirname(createRequire(join(cliRoot, 'package.json')).resolve('@isox-sh/core/package.json'))
  const packages = new Map([['isox', cliRoot], ['@isox-sh/core', coreRoot]])
  for (const [name, directory] of Object.entries(options.plugins ?? {})) {
    if (!/^(?:@[a-z0-9][a-z0-9._-]*\/)?[a-z0-9][a-z0-9._-]*$/.test(name)) {
      throw new Error(`Invalid plugin package name: ${name}.`)
    }

    if (packages.has(name)) {
      throw new Error(`Package ${name} is already supplied by the E2E helper. Use cliDirectory to select a different CLI.`)
    }

    if (typeof directory !== 'string' || !directory.trim()) {
      throw new Error(`Expected a package directory for ${name}.`)
    }

    const packageRoot = await realpath(resolve(workspaceRoot, directory))
    await readPackage(packageRoot, name)
    packages.set(name, packageRoot)
  }

  const temporaryDirectory = join(workspaceRoot, 'tmp')
  await mkdir(temporaryDirectory, { recursive: true })
  const root = await mkdtemp(join(temporaryDirectory, 'isox-e2e-'))
  const cleanup = () => rm(root, { recursive: true, force: true })
  try {
    await writeJson('package.json', { name: 'isox-e2e-workspace', private: true }, {
      projectRoot: root, logger: options.logger,
    }, { overwrite: false })
    for (const [name, directory] of packages) {
      const destination = join(root, 'node_modules', name)
      await mkdir(dirname(destination), { recursive: true })
      await symlink(directory, destination, 'junction')
    }
  } catch (error) {
    await cleanup()
    throw error
  }

  const env = { ...process.env }
  // Resolve fixture dependencies through its explicit links, without global overrides.
  delete env.NODE_PATH
  const runNode = async (args: string[], cwd = root): Promise<CommandOutput> => {
    try {
      return await execute(process.execPath, args, { cwd, env, encoding: 'utf8', timeout, maxBuffer })
    } catch (error) {
      const failure = error as Error & { stdout?: string, stderr?: string }
      throw new Error(`Command failed: node ${args.join(' ')}\nWorking directory: ${cwd}\n${failure.stdout ?? ''}${failure.stderr ?? ''}`, { cause: error })
    }
  }

  return {
    root,
    version: cliPackage.version,
    runIsox: (args, cwd) => runNode([cli, ...args], cwd),
    runNode,
    cleanup,
  }
}
