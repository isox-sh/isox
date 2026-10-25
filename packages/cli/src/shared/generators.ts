import { createRequire } from 'node:module'
import { dirname, resolve } from 'node:path'

import { resolvePackageJson } from '@isox-sh/core'

import type { ProjectAdder, ProjectInitializer } from '@isox-sh/core'

interface Generators {
  init: ProjectInitializer
  add: ProjectAdder
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

export function loadGenerator<Name extends keyof Generators>(packageName: string, name: Name, workspaceRoot: string): Generators[Name] {
  const packageFile = resolvePackageJson(packageName, workspaceRoot)
  const require = createRequire(packageFile)
  const manifest = require(packageFile)

  if (typeof manifest.generators !== 'string' || !manifest.generators.trim()) {
    throw new Error(`Package ${packageName} does not define a generators manifest. Declare "generators": "./generators.json" in package.json.`)
  }

  const registryFile = resolve(dirname(packageFile), manifest.generators)
  const registry = require(registryFile)

  if (!isRecord(registry) || !isRecord(registry.generators)) {
    throw new Error(`Invalid generators manifest in ${packageName}: expected a generators object.`)
  }

  const definition = Object.hasOwn(registry.generators, name) ? registry.generators[name] : undefined

  if (!isRecord(definition) || typeof definition.implementation !== 'string' || !definition.implementation.trim()) {
    throw new Error(`Generator ${packageName}:${name} must define an implementation in ${manifest.generators}.`)
  }

  const implementation = require(resolve(dirname(registryFile), definition.implementation))
  const generator = implementation?.default ?? implementation

  if (typeof generator !== 'function') {
    throw new Error(`Generator ${packageName}:${name} does not export a function.`)
  }

  return generator
}
