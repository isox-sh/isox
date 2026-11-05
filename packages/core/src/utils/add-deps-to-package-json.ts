import { lt, minVersion, validRange } from 'semver'

import { readJson } from './read-json'
import { writeJson } from './write-json'

import type { WriteJsonContext } from './write-json'

export interface PackageJsonDeps {
  dependencies?: Record<string, string>
  devDependencies?: Record<string, string>
}

export interface AddDepsToPackageJsonOptions {
  /** Upgrade older semantic version ranges, comparing their minimum versions. */
  upgradeExisting?: boolean
}

function isOlderVersion(current: string, requested: string): boolean {
  if (!validRange(current) || !validRange(requested)) {
    return false
  }

  const currentMinimum = minVersion(current)
  const requestedMinimum = minVersion(requested)

  return currentMinimum !== null && requestedMinimum !== null && lt(currentMinimum, requestedMinimum)
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

function validateDeps(value: unknown, field: string): asserts value is Record<string, string> {
  if (!isRecord(value) || Object.entries(value).some(([name, version]) =>
    name.length > 214 || !/^(?:@[a-z0-9~][a-z0-9._~-]*\/)?[a-z0-9~][a-z0-9._~-]*$/.test(name)
    || ['node_modules', 'favicon.ico'].includes(name) || typeof version !== 'string' || !version.trim(),
  )) {
    throw new Error(`Invalid ${field}: expected package names mapped to non-empty version strings.`)
  }
}

/** Add dependencies to the project's package.json, preserving existing versions by default. */
export async function addDepsToPackageJson(
  deps: PackageJsonDeps,
  context: WriteJsonContext,
  options: AddDepsToPackageJsonOptions = {},
): Promise<void> {
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

  const changedFields = new Set<typeof fields[number]>()

  for (const field of fields) {
    for (const [name, version] of Object.entries(deps[field] ?? {})) {
      const existingField = fields.find(key => Object.hasOwn(manifest[key] ?? {}, name))
      const destination = existingField ?? field
      const entries = (manifest[destination] ?? {}) as Record<string, string>

      if (existingField && (!options.upgradeExisting || !isOlderVersion(entries[name], version))) {
        continue
      }

      manifest[destination] = {
        ...entries,
        [name]: version
      }
      changedFields.add(destination)
    }
  }

  for (const field of changedFields) {
    manifest[field] = Object.fromEntries(Object.entries(manifest[field] as Record<string, string>).sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0))
  }

  if (changedFields.size > 0) {
    await writeJson('package.json', manifest, context, { overwrite: exists })
  }
}
