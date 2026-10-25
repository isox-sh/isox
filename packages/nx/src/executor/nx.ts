import { readFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { dirname, join, resolve } from 'node:path'

import { createNxProjectGraph, createNxTaskGraph } from './nx-graph'
import { loadNxWorkspaceGraph } from './nx-workspace-graph'

import type { NxProjectConfiguration } from './nx-graph'
import type { ExecutorContext, ExecutorOutput } from '@isox-sh/core'

/** Adapt Isox configuration and Nx dependency metadata without Nx's scheduler. */
async function createNxContext(context: ExecutorContext, pluginPackagePath: string) {
  const projects: Record<string, NxProjectConfiguration> = Object.fromEntries(Object.entries(context.workspace.projects).map(([name, project]) => {
    const { targets, dependencies, ...metadata } = project
    return [name, {
      ...metadata,
      name,
      targets: targets ?? {},
      implicitDependencies: dependencies ?? [],
      tags: project.tags ?? [],
    }]
  }))
  let nxJsonConfiguration: Record<string, unknown> = {}
  try {
    nxJsonConfiguration = JSON.parse(await readFile(join(context.workspaceRoot, 'nx.json'), 'utf8'))
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
      throw error
    }
  }

  const projectGraph = createNxProjectGraph(projects, await loadNxWorkspaceGraph(context, pluginPackagePath))
  const projectsConfigurations = {
    version: 2,
    projects: Object.fromEntries(Object.entries(projectGraph.nodes).map(([name, node]) => [name, node.data])),
  }

  return {
    root: context.workspaceRoot,
    cwd: context.workspaceRoot,
    projectName: context.projectName,
    targetName: context.commandName,
    configurationName: context.configurationName,
    target: context.command,
    isVerbose: context.verbose,
    workspace: projectsConfigurations,
    projectsConfigurations,
    nxJsonConfiguration,
    projectGraph,
    taskGraph: createNxTaskGraph(context),
  }
}

type NxExecutor = (
  options: Record<string, unknown>,
  context: Awaited<ReturnType<typeof createNxContext>>,
) => ExecutorOutput | Promise<ExecutorOutput>

export async function runNxExecutor(
  options: Record<string, unknown>,
  context: ExecutorContext,
  pluginPackagePath: string,
): Promise<ExecutorOutput> {
  const pluginRequire = createRequire(pluginPackagePath)
  const executorName = context.command.executor
  const [packageName, executorConfigName] = executorName.split(':')
  const pkgJson = pluginRequire(pluginPackagePath)
  const manifest = pkgJson.executors ?? pkgJson.builders
  if (typeof manifest !== 'string') {
    throw new Error(`Package ${packageName} does not define an executors or builders manifest.`)
  }

  const manifestPath = resolve(dirname(pluginPackagePath), manifest)
  const manifestJson = pluginRequire(manifestPath)
  const registry = manifestJson.executors ?? manifestJson.builders
  const executorDef = registry && Object.hasOwn(registry, executorConfigName) ? registry[executorConfigName] : undefined
  if (!executorDef || typeof executorDef.implementation !== 'string') {
    throw new Error(`Executor ${executorConfigName} not found in ${packageName}.`)
  }

  const implPath = resolve(dirname(manifestPath), executorDef.implementation)
  context.logger.debug(`Resolved ${executorName} to ${implPath}`)
  const executorModule = pluginRequire(implPath)
  const executor: NxExecutor = executorModule.default ?? executorModule
  if (typeof executor !== 'function') {
    throw new Error(`Executor ${executorName} does not export a function.`)
  }
  context.logger.debug(`Using Nx adapter for ${context.command.executor}`)
  const nxContext = await createNxContext(context, pluginPackagePath)
  if (context.signal?.aborted) {
    return { success: false }
  }

  return executor(options, nxContext)
}
