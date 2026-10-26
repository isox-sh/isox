import { endianness, release } from 'node:os'
import { isAbsolute, join, posix, relative, resolve } from 'node:path'

import { minimatch } from 'minimatch'

import { resolveCommandOptions } from '../executor/configuration'
import { resolveWorkspaceDependencies } from '../workspace/dependencies'
import { comparisonPath, digest, inside, noSymlinks, slash, snapshot, stableJson, statIfExists } from './files'
import { executorFiles, installedVersions } from './tools'

import type { ExecutorContext } from '../executor/types'
import type { ExecutorConfiguration, TaskInput } from '../workspace/configuration'

const reserved = new Set(['node_modules', '.git', '.isox'])
const lockfiles = ['pnpm-lock.yaml', 'package-lock.json', 'npm-shrinkwrap.json', 'yarn.lock', 'bun.lock', 'bun.lockb']

export function expandPath(pattern: string, projectRoot: string, projectName: string): string {
  const expanded = pattern.replaceAll('{projectName}', () => projectName).replaceAll('{projectRoot}', () => slash(projectRoot)).replaceAll('{workspaceRoot}/', '').replaceAll('{workspaceRoot}', '.')

  if (isAbsolute(expanded) || expanded.includes('\\') || expanded.includes('\0') || expanded.split('/').includes('..')) {
    throw new Error(`Task cache paths must stay inside the workspace: ${pattern}`)
  }

  return posix.normalize(expanded).replace(/^\.\//, '').replace(/\/$/, '')
}

export function outputPaths(command: ExecutorConfiguration, projectRoot: string, projectName: string): string[] {
  if (command.outputs === undefined) {
    return []
  }

  if (!Array.isArray(command.outputs) || command.outputs.some(path => typeof path !== 'string' || !path)) {
    throw new Error('Task outputs must be an array of non-empty directory paths.')
  }

  return command.outputs.map(path => {
    const expanded = expandPath(path, projectRoot, projectName)

    if (expanded === '.' || /[*?[\]{}()!]/.test(expanded) || expanded.split('/').some(part => reserved.has(part.toLowerCase()))) {
      throw new Error(`Unsafe task output directory: ${path}`)
    }

    return expanded
  }).sort()
}

export async function validateOutputs(context: ExecutorContext): Promise<string[]> {
  const paths = outputPaths(context.command, context.project.root, context.projectName)
  const actual = await Promise.all(paths.map(path => comparisonPath(resolve(context.workspaceRoot, path))))
  const workspaceRoot = await comparisonPath(context.workspaceRoot)
  const projects = await Promise.all(Object.values(context.workspace.projects).map(async project => ({
    name: project.name,
    root: await comparisonPath(resolve(context.workspaceRoot, project.root)),
  })))

  for (const [index, path] of paths.entries()) {
    const absolute = resolve(context.workspaceRoot, path)
    const output = actual[index]

    if (actual.some((other, otherIndex) => otherIndex !== index && inside(output, other))
      || projects.some(project => inside(output, project.root)
        || (project.name !== context.projectName && project.root !== workspaceRoot && inside(project.root, output)))) {
      throw new Error(`Task output overlaps another output or a project root: ${path}`)
    }

    await noSymlinks(context.workspaceRoot, absolute)
    const info = await statIfExists(absolute)

    if (info && !info.isDirectory()) {
      throw new Error(`Task output must be a directory: ${path}`)
    }
  }

  return paths
}

async function fileInputs(root: string, projectRoot: string, inputs: TaskInput[], outputs: string[], projectName = ''): Promise<unknown> {
  const patterns = inputs.filter((input): input is string => typeof input === 'string')
  const positive = patterns.filter(pattern => !pattern.startsWith('!')).map(pattern => expandPath(pattern, projectRoot, projectName))
  const negative = patterns.filter(pattern => pattern.startsWith('!')).map(pattern => expandPath(pattern.slice(1), projectRoot, projectName))
  const matches = (path: string, pattern: string) => minimatch(path, pattern, {
    dot: true,
    nonegate: true,
    nocomment: true
  }) || pattern === '.' || path === pattern || path.startsWith(`${pattern}/`)
  const excluded = (path: string) => {
    const rel = slash(relative(root, path))

    return rel.split('/').some(part => reserved.has(part.toLowerCase()))
      || outputs.some(output => rel === output || rel.startsWith(`${output}/`))
      || negative.some(pattern => matches(rel, pattern))
  }

  const selected = (path: string) => positive.some(pattern => matches(slash(relative(root, path)), pattern))
  const files = new Map()
  // Start at each glob's literal prefix rather than walking the whole workspace.
  for (const pattern of positive) {
    const prefix = pattern.split('/').filter((_part, index, parts) => !parts.slice(0, index + 1).some(part => /[*?[\]{}()!]/.test(part))).join('/')
    const base = resolve(root, prefix || '.')

    if (excluded(base)) {
      continue
    }

    await noSymlinks(root, base)

    for (const entry of await snapshot(base, excluded, selected)) {
      if (entry.kind !== 'file') {
        continue
      }

      const path = slash(join(prefix, entry.path))

      files.set(path, {
        ...entry,
        path
      })
    }
  }

  const environment = inputs.filter((input): input is Exclude<TaskInput, string> => typeof input !== 'string')
    .map(input => [input.env, process.env[input.env] ?? null]).sort(([a], [b]) => a! < b! ? -1 : a! > b! ? 1 : 0)

  return {
    patterns,
    files: [...files.entries()].sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0),
    environment
  }
}

/** Hash actual contents, not discovery fingerprints or task-success metadata. */
export async function taskHash(context: ExecutorContext, options: Record<string, unknown>, executorPackage: string): Promise<string> {
  const root = context.workspaceRoot
  const workspace = await resolveWorkspaceDependencies(root, context.workspace, {
    projects: [context.projectName],
    logger: context.logger
  })
  const pending = new Set([context.projectName])
  const outputs = outputPaths(context.command, context.project.root, context.projectName)
  const tasks = []

  for (const name of pending) {
    const project = workspace.projects[name]

    if (!project) {
      throw new Error(`Unknown task dependency: ${name}`)
    }

    const command = Object.hasOwn(project.targets ?? {}, context.commandName) ? project.targets![context.commandName] : undefined
    const configuration = command && name !== context.projectName
      ? resolveCommandOptions(command, name, context.commandName, context.configurationName && Object.hasOwn(command.configurations ?? {}, context.configurationName) ? context.configurationName : undefined)
      : undefined
    const inputs = command?.inputs ?? ['{projectRoot}/**/*']
    const dependencyOutputs = name !== context.projectName && command?.cache === true
      ? outputPaths(command, project.root, project.name)
      : []

    tasks.push({
      name,
      project,
      configuration,
      inputs: await fileInputs(root, project.root, inputs, [...outputs, ...dependencyOutputs], project.name),
      // Without a prerequisite scheduler, source hashes alone cannot tell whether
      // a dependency was rebuilt. Include its actual declared build artifacts.
      artifacts: name !== context.projectName
        ? await fileInputs(root, '.', dependencyOutputs, outputs)
        : undefined,
    })

    for (const dependency of project.dependencies ?? []) {
      pending.add(dependency)
    }
  }

  const plugin = await executorFiles(executorPackage, context.command.executor)
  const manifests = [...pending].map(name => join(root, workspace.projects[name].root, 'package.json'))
  const tools = await installedVersions([executorPackage, resolve(__dirname, '../package.json'), join(root, 'package.json'), ...manifests])
  const shared = await fileInputs(root, '.', ['package.json', 'isox.json', 'tsconfig.json', 'tsconfig.base.json', '.gitignore', '.isoxignore', ...lockfiles], outputs)

  return digest(stableJson({
    version: 2,
    // Absolute paths can affect sourcemaps and arbitrary native plugins. Prefer
    // a conservative miss when moving a checkout to another location.
    root,
    runtime: [process.version, process.versions, process.platform, process.arch, release(), endianness()],
    command: context.commandName,
    configuration: context.configurationName,
    options,
    tasks: tasks.sort((a, b) => a.name < b.name ? -1 : a.name > b.name ? 1 : 0),
    plugin,
    tools,
    shared,
  }))
}
