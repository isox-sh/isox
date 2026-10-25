import { isBuiltin } from 'node:module'
import { dirname, isAbsolute, resolve } from 'node:path'

import { readSourceDependencies } from '@isox-sh/core'
import ts from 'typescript'

import { canonical, inside } from './files'
import { defaultManifest, optionalManifest, versionPattern } from './package-manifest'

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

  for await (const [file, { runtime, all }] of readSourceDependencies(sources.filter(file => !/\.d\.[cm]?ts$/.test(file)))) {
    for (const specifier of all) {
      if (isBuiltin(specifier) || specifier.startsWith('.') || specifier.startsWith('#')
        || isAbsolute(specifier) || /^[a-z][a-z\d+.-]*:/i.test(specifier)) {
        continue
      }

      const name = specifier.startsWith('@') ? specifier.split('/').slice(0, 2).join('/') : specifier.split('/')[0]

      // Published declarations also need the workspace packages referenced by their types.
      if (!runtime.has(specifier) && !workspacePackages.has(name)) {
        continue
      }

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

/** Replace workspace protocols with publishable versions, preserving aliases. */
export async function workspaceDependencies(manifest: Manifest, context: PackageJsonContext, root: Manifest): Promise<void> {
  const packages = new Map<string, Manifest>()
  const add = async (directory: string) => {
    const path = resolve(directory, 'package.json')
    const pkg = await optionalManifest(path) ?? defaultManifest(directory, context, root)

    if (typeof pkg.name === 'string') {
      if (packages.has(pkg.name)) {
        throw new Error(`Duplicate workspace package name: ${pkg.name}`)
      }

      packages.set(pkg.name, pkg)
    }
  }

  const projectDirectories = Object.values(context.workspace?.projects ?? {})
    .map(project => resolve(context.workspaceRoot, project.root))
  const projectRoots = await Promise.all(projectDirectories.map(canonical))
  const directories = new Set([context.projectRoot, ...projectDirectories])

  for (const directory of directories) {
    await add(directory)
  }

  for (const field of ['dependencies', 'optionalDependencies', 'peerDependencies']) {
    const dependencies = manifest[field]

    if (!dependencies || typeof dependencies !== 'object' || Array.isArray(dependencies)) {
      continue
    }

    for (const [name, specifier] of Object.entries(dependencies)) {
      if (typeof specifier !== 'string' || !specifier.startsWith('workspace:')) {
        continue
      }

      let range = specifier.slice(10)
      let packageName = name
      const alias = range.lastIndexOf('@')

      if (!range.startsWith('.') && alias > 0) {
        packageName = range.slice(0, alias)
        range = range.slice(alias + 1)
      }

      let pkg = packages.get(packageName)

      if (range.startsWith('.')) {
        const directory = await canonical(resolve(context.projectRoot, range))

        if (!inside(await canonical(context.workspaceRoot), directory)) {
          throw new Error(`Workspace dependency escapes the workspace: ${specifier}`)
        }

        pkg = await optionalManifest(resolve(directory, 'package.json'))
        const projectDirectory = projectDirectories[projectRoots.indexOf(directory)]

        if (!pkg && projectDirectory) {
          pkg = defaultManifest(projectDirectory, context, root)
        }

        if (!pkg) {
          throw new Error(`Workspace dependency is not an Isox project and has no package.json: ${specifier}`)
        }

        if (typeof pkg.name !== 'string') {
          throw new Error(`Workspace dependency has no package name: ${specifier}`)
        }

        packageName = pkg.name
        range = '*'
      }

      if (!pkg || typeof pkg.version !== 'string' || !versionPattern.test(pkg.version)) {
        throw new Error(`Cannot resolve workspace dependency ${name}: declare its package name and version in an Isox project.`)
      }

      if (!['*', '^', '~'].includes(range)) {
        throw new Error(`Unsupported workspace range ${specifier}; use workspace:*, workspace:^, or workspace:~.`)
      }

      const version = `${range === '*' ? '' : range}${pkg.version}`

      dependencies[name] = name === packageName ? version : `npm:${packageName}@${version}`
    }
  }
}
