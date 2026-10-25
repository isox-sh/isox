import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { dirname, join, relative, resolve } from 'node:path'

import { resolveCommandOptions } from '@isox-sh/core'
import ts from 'typescript'

import { inside } from './files'

import type { ExecutorContext } from '@isox-sh/core'

function readConfig(file: string, onRead?: (file: string) => void): ts.ParsedCommandLine {
  const fail = (error: ts.Diagnostic): never => {
    throw new Error(`Invalid TypeScript configuration in ${file}: ${ts.flattenDiagnosticMessageText(error.messageText, '\n')}`)
  }

  const parsed = ts.getParsedCommandLineOfConfigFile(file, {}, {
    ...ts.sys,
    readFile: path => {
      onRead?.(path)

      return ts.sys.readFile(path)
    },
    onUnRecoverableConfigFileDiagnostic: fail
  })!
  const error = parsed.errors.find(error => error.code !== 18002 && error.code !== 18003)

  if (error) {
    fail(error)
  }

  return parsed
}

/** Keep source aliases for editors; compile each package against its dependencies' outputs. */
export function buildConfiguration(tsConfig: string, context: ExecutorContext, onRead?: (file: string) => void) {
  const workspace = context.workspace?.projects ?? {}
  const dependencies = new Set(workspace[context.projectName]?.dependencies ?? [])

  for (const name of dependencies) {
    for (const dependency of workspace[name]?.dependencies ?? []) {
      dependencies.add(dependency)
    }
  }

  if (!dependencies.size) {
    return undefined
  }

  const projects = Object.values(workspace)
    .map(project => ({
      project,
      root: resolve(context.workspaceRoot, project.root)
    }))
    .sort((a, b) => b.root.length - a.root.length)
  const parsed = readConfig(tsConfig, onRead)
  const base = parsed.options.baseUrl ?? parsed.options.pathsBasePath
  const outputs = new Set<string>()
  const configurations = new Map<string, ts.ParsedCommandLine>()
  const remap = (target: string): string => {
    const absolute = resolve(typeof base === 'string' ? base : dirname(tsConfig), target)
    const prefix = absolute.split('*')[0]
    const owner = projects.find(project => inside(project.root, prefix))

    if (!owner || !dependencies.has(owner.project.name) || owner.root === context.projectRoot || /\.d\.[cm]?ts$/.test(absolute)) {
      return absolute
    }

    const targets = owner.project.targets ?? {}
    const commandName = Object.hasOwn(targets, context.commandName) ? context.commandName : 'build'
    const command = Object.hasOwn(targets, commandName) ? targets[commandName] : undefined
    const configuration = context.configurationName && Object.hasOwn(command?.configurations ?? {}, context.configurationName)
      ? context.configurationName
      : undefined
    const options = command ? resolveCommandOptions(command, owner.project.name, commandName, configuration).options : {}
    const configPath = typeof options.tsConfig === 'string'
      ? resolve(context.workspaceRoot, options.tsConfig)
      : join(owner.root, 'tsconfig.json')

    onRead?.(configPath)

    if (!ts.sys.fileExists(configPath)) {
      return absolute
    }

    let dependency = configurations.get(configPath)

    if (!dependency) {
      dependency = readConfig(configPath, onRead)
      configurations.set(configPath, dependency)
    }

    const root = dependency.options.rootDir ?? dirname(configPath)
    const output = dependency.options.declarationDir ?? dependency.options.outDir

    if (!output || !inside(root, prefix) || dependency.options.noEmit) {
      return absolute
    }

    outputs.add(output)

    return resolve(output, relative(root, absolute)).replace(/\.([cm]?)tsx?$/, '.d.$1ts')
  }

  const paths = Object.fromEntries(Object.entries(parsed.options.paths ?? {}).map(([alias, targets]) => [alias, targets.map(remap)]))

  if (!outputs.size) {
    return undefined
  }

  return {
    outputs: [...outputs],
    config: {
      extends: tsConfig,
      compilerOptions: {
        paths,
        // Preserve type lookup and TS 7's default rootDir (the original config directory).
        typeRoots: parsed.options.typeRoots ?? ts.getEffectiveTypeRoots(parsed.options, ts.sys),
        rootDir: parsed.options.rootDir ?? dirname(tsConfig),
        // Freeze config-relative paths, including values that use ${configDir}.
        outDir: parsed.options.outDir,
        declarationDir: parsed.options.declarationDir,
        rootDirs: parsed.options.rootDirs,
        baseUrl: parsed.options.baseUrl,
        mapRoot: parsed.options.mapRoot,
        sourceRoot: parsed.options.sourceRoot,
      },
      files: parsed.fileNames,
      include: [],
      references: parsed.projectReferences?.map(reference => ({ path: reference.path })),
    },
  }
}

export async function withBuildConfig<T>(
  tsConfig: string,
  context: ExecutorContext,
  stateFile: string,
  compile: (config: string) => Promise<T>,
): Promise<T> {
  const configuration = buildConfiguration(tsConfig, context)

  if (!configuration) {
    return compile(tsConfig)
  }

  const directory = await mkdtemp(join(dirname(stateFile), 'config-'))

  try {
    const file = join(directory, 'tsconfig.json')

    await writeFile(file, JSON.stringify(configuration.config))

    return await compile(file)
  } finally {
    await rm(directory, {
      recursive: true,
      force: true
    })
  }
}
