import { readFile } from 'node:fs/promises'
import { isBuiltin } from 'node:module'
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path'

import ts from 'typescript'

import { resolveCommandOptions } from '../executor/configuration'
import { readSourceDependencies } from '../utils/source-dependencies'
import { writeCacheFile } from './cache'
import { fingerprint, readDependencyCache, resolutionReadsMatch, resolutionSystem, sourceFingerprint } from './dependency-cache'
import { discoverWorkspace } from './discovery'

import type { Logger } from '../logger'
import type { ResolutionRead } from './dependency-cache'
import type { ProjectConfiguration, WorkspaceGraph } from './parser'

export interface DependencyOptions {
  /** Limit source analysis to these projects and their transitive dependencies. */
  projects?: string[]
  logger?: Logger
}

interface ProjectOutput {
  root: string
  name: string
  projectRoot: string
  rootDir: string
}

interface ProjectSources {
  project: ProjectConfiguration
  root: string
  prefix: string
  manifest: Record<string, unknown>
  options: ts.CompilerOptions
}

function inside(root: string, file: string): boolean {
  const path = relative(root, file)

  return path !== '..' && !path.startsWith(`..${sep}`) && !isAbsolute(path)
}

async function readManifest(file: string): Promise<Record<string, unknown>> {
  let source: string

  try {
    source = await readFile(file, 'utf8')
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      return {}
    }

    throw error
  }

  try {
    const manifest = JSON.parse(source)

    if (manifest && typeof manifest === 'object' && !Array.isArray(manifest)) {
      return manifest
    }
  } catch (error) {
    throw new SyntaxError(`Invalid package manifest in ${file}.`, { cause: error })
  }

  throw new Error(`Invalid package manifest in ${file}: expected an object.`)
}

function compilerOptions(file: string | undefined): ts.CompilerOptions {
  if (!file) {
    return {}
  }

  const fail = (error: ts.Diagnostic): never => {
    throw new Error(`Invalid TypeScript configuration in ${file}: ${ts.flattenDiagnosticMessageText(error.messageText, '\n')}`)
  }

  const config = ts.getParsedCommandLineOfConfigFile(file, {}, {
    ...ts.sys,
    onUnRecoverableConfigFileDiagnostic: fail
  })
  // A shared config may contain only aliases, without any source files of its own.
  const error = config?.errors.find(error => error.code !== 18002 && error.code !== 18003)

  if (error) {
    fail(error)
  }

  return config?.options ?? {}
}

function packageName(specifier: string): string {
  return specifier.startsWith('@') ? specifier.split('/').slice(0, 2).join('/') : specifier.split('/')[0]
}

/** Resolve dependencies on request, caching analysis separately from the supplied definitions. */
export async function resolveWorkspaceDependencies(
  workspaceRoot: string,
  definitions: WorkspaceGraph,
  request: DependencyOptions = {},
): Promise<WorkspaceGraph> {
  workspaceRoot = resolve(workspaceRoot)
  const workspace: WorkspaceGraph = {
    projects: Object.assign(Object.create(null), Object.fromEntries(
      Object.entries(definitions.projects).map(([name, project]) => [name, { ...project }]),
    ))
  }
  const pending = new Set(request.projects ?? Object.keys(workspace.projects))

  for (const name of pending) {
    if (!Object.hasOwn(workspace.projects, name)) {
      throw new Error(`Project ${name} not found in workspace.`)
    }
  }

  if (!pending.size) {
    return workspace
  }

  const baseConfig = ['tsconfig.base.json', 'tsconfig.json'].map(file => join(workspaceRoot, file)).find(ts.sys.fileExists)
  const sharedOptions = compilerOptions(baseConfig)
  const projects: ProjectSources[] = []
  const packages = new Map<string, string>()
  const outputs: ProjectOutput[] = []

  for (const project of Object.values(workspace.projects)) {
    const root = resolve(workspaceRoot, project.root)
    const manifest = await readManifest(join(root, 'package.json'))
    const name = typeof manifest.name === 'string' ? manifest.name : project.name

    if (packages.has(name)) {
      throw new Error(`Duplicate workspace package name ${name} in projects ${packages.get(name)} and ${project.name}.`)
    }

    packages.set(name, project.name)
    const editorConfig = join(root, 'tsconfig.json')
    const config = ts.sys.fileExists(editorConfig) ? editorConfig : baseConfig
    const options = config === baseConfig ? sharedOptions : compilerOptions(config)
    const build = project.targets?.build
    const buildOptions = build ? resolveCommandOptions(build, project.name, 'build').options : {}
    const buildConfig = typeof buildOptions.tsConfig === 'string'
      ? resolve(workspaceRoot, buildOptions.tsConfig)
      : undefined
    // A named configuration can override a missing base config at execution time.
    const outputConfig = buildConfig && ts.sys.fileExists(buildConfig) ? buildConfig : config
    const outputOptions = outputConfig === config ? options : compilerOptions(outputConfig)

    projects.push({
      project,
      root,
      prefix: root.endsWith(sep) ? root : `${root}${sep}`,
      manifest,
      options
    })
    // Editor aliases describe sources; the build config owns emitted files.
    for (const directory of outputOptions.noEmit ? [] : [outputOptions.outDir, outputOptions.declarationDir]) {
      if (directory && inside(workspaceRoot, directory) && !inside(directory, root)) {
        outputs.push({
          root: directory,
          name: project.name,
          projectRoot: root,
          rootDir: outputOptions.rootDir ?? (outputConfig ? dirname(outputConfig) : root)
        })
      }
    }
  }

  const outputDirectories = outputs.map(output => output.root)
  // Configurations and manifests are read fresh on every explicit request. Their
  // effective values cover extended configs, package names and output ownership.
  const configuration = fingerprint([ts.version, workspaceRoot, projects, outputs])
  const cache = await readDependencyCache(workspaceRoot, configuration)
  let changed = false
  // A shared outDir preserves each project's path relative to rootDir. Never assign
  // the entire shared directory to whichever project happened to be discovered first.
  const ownedOutputs = outputs.flatMap(output => {
    if (new Set(outputs.filter(other => other.root === output.root).map(other => other.name)).size === 1) {
      return [output]
    }

    const { rootDir, projectRoot } = output

    if (rootDir === projectRoot || !inside(rootDir, projectRoot)) {
      return []
    }

    return [{
      ...output,
      root: resolve(output.root, relative(rootDir, projectRoot))
    }]
  })

  // A file in a nested project belongs to that project, not its enclosing project.
  projects.sort((a, b) => b.root.length - a.root.length || a.project.name.localeCompare(b.project.name))
  const roots = [...projects.map(({ root, project }) => ({
    root,
    name: project.name
  })), ...ownedOutputs]
    .sort((a, b) => b.root.length - a.root.length)
  const owner = (file: string): string | undefined => roots.find(entry => inside(entry.root, file))?.name
  const edges = new Map(projects.map(({ project }) => [project.name, new Set(project.dependencies ?? [])]))

  const add = (project: string, dependency: string | undefined) => {
    if (dependency && dependency !== project) {
      edges.get(project)!.add(dependency)
    }
  }

  for (const { project, root, manifest } of projects) {
    for (const field of ['dependencies', 'devDependencies', 'optionalDependencies', 'peerDependencies']) {
      const entries = manifest[field]

      if (!entries || typeof entries !== 'object' || Array.isArray(entries)) {
        continue
      }

      for (const [name, version] of Object.entries(entries)) {
        const local = typeof version === 'string' && /^(?:workspace|file|link):\./.test(version)
        const alias = typeof version === 'string' && /^(?:workspace|npm):(@?[^@]+)@/.exec(version)

        add(project.name, local ? owner(resolve(root, version.slice(version.indexOf(':') + 1))) : packages.get(alias ? alias[1] : name))
      }
    }
  }

  const files = (await discoverWorkspace(workspaceRoot, { sources: true })).sources
  const sources = new Map(projects.map(({ project }) => [project.name, [] as string[]]))

  for (const file of files) {
    const source = projects.find(project => file.startsWith(project.prefix))

    if (source && !outputDirectories.some(output => inside(output, file))) {
      sources.get(source.project.name)!.push(file)
    }
  }

  // Set iteration visits newly found dependencies, so scoped requests analyze
  // their closure without parsing sources from unrelated projects.
  for (const name of pending) {
    const source = projects.find(({ project }) => project.name === name)

    if (!source) {
      throw new Error(`Unknown project dependency ${name}. Use project names in dependencies.`)
    }

    const { project, options } = source
    const projectFiles = sources.get(name)!
    const sourceKey = await sourceFingerprint(projectFiles)
    const cached = cache.projects[name]

    if (cached && cached.sources === sourceKey
      && cached.dependencies.every(dependency => Object.hasOwn(workspace.projects, dependency))
      && resolutionReadsMatch(cached.reads)) {
      edges.set(name, new Set(cached.dependencies))

      for (const dependency of cached.dependencies) {
        pending.add(dependency)
      }

      continue
    }

    const reads = new Map<string, ResolutionRead>()
    const system = resolutionSystem(reads)

    for await (const [file, { all }] of readSourceDependencies(projectFiles)) {
      for (const specifier of all) {
        if (isBuiltin(specifier)) {
          continue
        }

        if (specifier.startsWith('.') || isAbsolute(specifier)) {
          add(project.name, owner(resolve(dirname(file), specifier)))
          continue
        }

        // Resolve aliases before package names, including aliases to not-yet-built output.
        const patterns = Object.keys(options.paths ?? {}).sort((a, b) => {
          if (a === specifier || b === specifier) {
            return a === specifier ? -1 : 1
          }

          return b.split('*')[0].length - a.split('*')[0].length
        })
        const pattern = patterns.find(pattern => {
          const [prefix, suffix = ''] = pattern.split('*')

          return pattern.includes('*') ? specifier.startsWith(prefix) && specifier.endsWith(suffix) && specifier.length >= prefix.length + suffix.length : pattern === specifier
        })

        if (pattern) {
          const [prefix, suffix = ''] = pattern.split('*')
          const wildcard = specifier.slice(prefix.length, specifier.length - suffix.length)
          const base = options.baseUrl ?? options.pathsBasePath
          const resolved = ts.resolveModuleName(specifier, file, options, system).resolvedModule
          const targets = options.paths![pattern].map(target =>
            resolve(typeof base === 'string' ? base : workspaceRoot, target.replace('*', wildcard)),
          )

          // TypeScript selects the first resolving fallback. If outputs do not exist
          // yet, retain only the first known owner so build ordering still works.
          add(project.name, resolved ? owner(resolved.resolvedFileName) : targets.map(owner).find(Boolean))
        } else {
          add(project.name, packages.get(packageName(specifier)))
        }
      }
    }

    for (const dependency of edges.get(name)!) {
      pending.add(dependency)
    }

    const resolutionReads = [...reads.values()]

    if (await sourceFingerprint(projectFiles) !== sourceKey || !resolutionReadsMatch(resolutionReads)) {
      throw new Error('Dependency inputs changed during analysis. Retry once files have settled.')
    }

    cache.projects[name] = {
      sources: sourceKey,
      dependencies: [...edges.get(name)!].sort(),
      reads: resolutionReads
    }
    changed = true
  }

  for (const name of pending) {
    const project = workspace.projects[name]
    const dependencies = edges.get(name)!

    if (dependencies.size || project.dependencies !== undefined) {
      project.dependencies = [...dependencies].sort()
    }
  }

  if (changed) {
    await writeCacheFile(workspaceRoot, 'discovery.json', cache, request.logger)
  }

  return workspace
}
