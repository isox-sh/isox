import { readFile } from 'node:fs/promises'
import { isBuiltin } from 'node:module'
import { dirname, isAbsolute, resolve } from 'node:path'

import ts from 'typescript'

import { inside } from './files'
import { defaultManifest, optionalManifest } from './package-manifest'
import { sourceDependencies } from './source-dependencies'

import type { PackageJsonContext, PackageJsonOptions } from './package-json'
import type { Manifest } from './package-manifest'

const fields = ['dependencies', 'optionalDependencies', 'peerDependencies', 'devDependencies'] as const

function dependency(manifest: Manifest, name: string, includeDev = true): string | undefined {
  for (const field of includeDev ? fields : fields.slice(0, 3)) {
    const entries = manifest[field]
    if (entries && typeof entries === 'object' && !Array.isArray(entries) && typeof entries[name] === 'string') {
      return entries[name]
    }
  }
  return undefined
}

/** Infer runtime dependencies without requiring a manifest in every project. */
export async function inferDependencies(
  manifest: Manifest,
  root: Manifest,
  context: PackageJsonContext,
  options: PackageJsonOptions,
  emitted: Set<string>,
): Promise<void> {
  const configPath = options.tsConfig
    ? resolve(context.workspaceRoot, options.tsConfig)
    : ts.findConfigFile(context.projectRoot, ts.sys.fileExists)
  let compilerOptions: ts.CompilerOptions = {}
  let sources = options.sourceFiles
  if (configPath) {
    const config = ts.readConfigFile(configPath, ts.sys.readFile)
    if (config.error) {
      throw new Error(ts.flattenDiagnosticMessageText(config.error.messageText, '\n'))
    }
    const parsed = ts.parseJsonConfigFileContent(config.config, ts.sys, dirname(configPath))
    compilerOptions = parsed.options
    sources ??= parsed.fileNames
  }
  sources ??= [...emitted].filter(file => /\.[cm]?jsx?$/.test(file))

  const workspacePackages = new Set<string>()
  for (const project of Object.values(context.workspace?.projects ?? {})) {
    const directory = resolve(context.workspaceRoot, project.root)
    const pkg = await optionalManifest(resolve(directory, 'package.json')) ?? defaultManifest(directory, context, root)
    if (typeof pkg.name === 'string') {
      workspacePackages.add(pkg.name)
    }
  }
  const required = new Set<string>()
  for (const file of sources) {
    if (/\.d\.[cm]?ts$/.test(file)) {
      continue
    }
    for (const specifier of sourceDependencies(file, await readFile(file, 'utf8'))) {
      if (isBuiltin(specifier) || specifier.startsWith('.') || specifier.startsWith('#')
        || isAbsolute(specifier) || /^[a-z][a-z\d+.-]*:/i.test(specifier)) {
        continue
      }
      const name = specifier.startsWith('@') ? specifier.split('/').slice(0, 2).join('/') : specifier.split('/')[0]
      if (name === manifest.name) {
        continue
      }
      const resolved = ts.resolveModuleName(specifier, file, compilerOptions, ts.sys).resolvedModule
      if (resolved && !resolved.isExternalLibraryImport && inside(context.projectRoot, resolved.resolvedFileName)) {
        continue
      }
      required.add(name)
    }
  }
  for (const name of [...required].sort()) {
    // Explicit runtime, optional, and peer declarations retain their classification.
    if (dependency(manifest, name, false)) {
      continue
    }
    const version = dependency(manifest, name) ?? dependency(root, name)
      ?? (workspacePackages.has(name) ? 'workspace:*' : undefined)
    if (!version) {
      throw new Error(`Cannot determine a version for dependency ${name}; declare it in the project or workspace package.json.`)
    }
    let entries = manifest.dependencies
    if (!entries || typeof entries !== 'object' || Array.isArray(entries)) {
      entries = {}
      manifest.dependencies = entries
    }
    entries[name] = version
  }
}
