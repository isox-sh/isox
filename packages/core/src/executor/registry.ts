import { createRequire } from 'node:module'
import { dirname, resolve } from 'node:path'

import { resolvePackageJson } from '../utils/resolve-package-json'

import type { WorkspaceSettings } from '../workspace/settings'
import type { ExecutorPlanner } from './types'

const pluginRequire = createRequire(__filename)

interface ResolvedExecutorPackage {
  pkg: string
  pkgJsonPath: string
}

export function resolveExecutor(executorName: string, root: string, settings: WorkspaceSettings) {
  const [packageName] = executorName.split(':')
  const matchesNxPackage = (pkg: string): boolean => (settings.nx?.executors ?? []).some(entry =>
    entry === pkg || (entry.startsWith('@') && !entry.includes('/') && pkg.startsWith(`${entry}/`)),
  )
  // Explicit Nx selection must resolve nx:* to nx, not the @isox-sh/nx adapter.
  const { pkg, pkgJsonPath } = resolveExecutorPackage(packageName, root, !matchesNxPackage(packageName))
  const isNxExecutor = matchesNxPackage(pkg)

  return {
    pkg,
    pkgJsonPath,
    isNxExecutor
  }
}

export function nativeEntry(pkg: string, pkgJsonPath: string, executorName: string, field: 'implementation' | 'planner') {
  const [, executorConfigName] = executorName.split(':')
  const pkgJson = pluginRequire(pkgJsonPath)
  const manifest = pkgJson.executors

  // A planning host may have the underlying tool installed without its Isox plugin.
  if (field === 'planner' && manifest === undefined) {
    return undefined
  }

  if (typeof manifest !== 'string') {
    throw new Error(`Package ${pkg} does not define an executors manifest.`)
  }

  const manifestPath = resolve(dirname(pkgJsonPath), manifest)
  const registry = pluginRequire(manifestPath).executors
  const executorDef = registry && Object.hasOwn(registry, executorConfigName) ? registry[executorConfigName] : undefined

  if (!executorDef || typeof executorDef.implementation !== 'string') {
    throw new Error(`Executor ${executorConfigName} not found in ${pkg}.`)
  }

  const entry = executorDef[field]
  if (field === 'planner' && entry === undefined) {
    return undefined
  }

  if (typeof entry !== 'string' || !entry.trim()) {
    throw new Error(`Invalid ${field} entry for ${executorName}.`)
  }

  return resolve(dirname(manifestPath), entry)
}

export function loadExecutorPlanner(executor: string, root: string, settings: WorkspaceSettings): ExecutorPlanner | undefined {
  let resolved

  try {
    resolved = resolveExecutor(executor, root, settings)
  } catch (error) {
    // Planning has always supported workspaces whose worker-only tools are not installed.
    if ((error as NodeJS.ErrnoException).code === 'MODULE_NOT_FOUND') {
      return undefined
    }

    throw error
  }

  const { pkg, pkgJsonPath, isNxExecutor } = resolved
  if (isNxExecutor) {
    return undefined
  }

  const path = nativeEntry(pkg, pkgJsonPath, executor, 'planner')
  if (!path) {
    return undefined
  }

  const entry = pluginRequire(path)
  const planner = entry.default ?? entry
  if (typeof planner !== 'function') {
    throw new Error(`Planner for ${executor} does not export a function.`)
  }

  return planner
}

function resolveExecutorPackage(packageName: string, root: string, allowShorthand: boolean): ResolvedExecutorPackage {
  const candidates = allowShorthand && !packageName.startsWith('@') && !packageName.includes('/')
    ? [`@isox-sh/${packageName}`, packageName]
    : [packageName]
  let resolutionError: unknown

  for (const pkg of candidates) {
    try {
      return {
        pkg,
        pkgJsonPath: resolvePackageJson(pkg, root)
      }
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'MODULE_NOT_FOUND') {
        throw error
      }

      // The CLI installs core transitively, so built-ins can use this copy.
      if (pkg === '@isox-sh/core') {
        return {
          pkg,
          pkgJsonPath: resolve(__dirname, '../package.json')
        }
      }

      resolutionError = error
    }
  }

  throw resolutionError
}
