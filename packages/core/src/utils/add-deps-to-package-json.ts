import { readJson } from './read-json'
import { writeJson } from './write-json'

import type { WriteJsonContext } from './write-json'

export interface PackageJsonDeps {
  dependencies?: Record<string, string>
  devDependencies?: Record<string, string>
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

function validateDeps(value: unknown, field: string): asserts value is Record<string, string> {
  if (!isRecord(value) || Object.entries(value).some(([name, version]) =>
    !name.trim() || typeof version !== 'string' || !version.trim(),
  )) {
    throw new Error(`Invalid ${field}: expected package names mapped to non-empty version strings.`)
  }
}

/** Add missing dependencies to the project's package.json, preserving existing versions. */
export async function addDepsToPackageJson(deps: PackageJsonDeps, context: WriteJsonContext): Promise<void> {
  const fields = ['dependencies', 'devDependencies'] as const
  for (const field of fields) {
    if (deps[field] !== undefined) {
      validateDeps(deps[field], field)
    }
  }

  for (const name of Object.keys(deps.dependencies ?? {})) {
    if (Object.hasOwn(deps.devDependencies ?? {}, name)) {
      throw new Error(`Dependency ${name} cannot be added to both dependencies and devDependencies.`)
    }
  }

  if (fields.every(field => Object.keys(deps[field] ?? {}).length === 0)) {
    return
  }

  let manifest: unknown
  let exists = true
  try {
    manifest = await readJson('package.json', context)
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
      throw error
    }
    manifest = {}
    exists = false
  }

  if (!isRecord(manifest)) {
    throw new Error('Invalid package.json: expected an object.')
  }

  for (const field of fields) {
    if (manifest[field] !== undefined) {
      validateDeps(manifest[field], `package.json ${field}`)
    }
  }

  let changed = false
  for (const field of fields) {
    let entries = (manifest[field] ?? {}) as Record<string, string>
    let fieldChanged = false
    for (const [name, version] of Object.entries(deps[field] ?? {})) {
      // Keep a dependency in its existing section and retain its chosen version.
      if (fields.some(key => Object.hasOwn(manifest[key] ?? {}, name))) {
        continue
      }
      entries = { ...entries, [name]: version }
      fieldChanged = true
    }

    if (fieldChanged) {
      manifest[field] = Object.fromEntries(Object.entries(entries).sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0))
      changed = true
    }
  }

  if (changed) {
    await writeJson('package.json', manifest, context, { overwrite: exists })
  }
}
