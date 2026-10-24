import { readFile } from 'node:fs/promises'
import { join } from 'node:path'

import { createNxProjectGraph, createNxTaskGraph } from './nx-graph'
import { loadNxWorkspaceGraph } from './nx-workspace-graph'

import type { NxProjectConfiguration } from './nx-graph'
import type { ExecutorContext, ExecutorOutput } from './types'

/** Adapt Isox configuration and Nx dependency metadata without Nx's scheduler. */
async function createNxContext(context: ExecutorContext, pluginPackagePath: string) {
  const projects: Record<string, NxProjectConfiguration> = Object.fromEntries(Object.entries(context.workspace.projects).map(([name, project]) => {
    const { commands, dependencies, ...metadata } = project
    return [name, {
      ...metadata,
      name,
      targets: commands ?? {},
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
  executor: NxExecutor,
  options: Record<string, unknown>,
  context: ExecutorContext,
  pluginPackagePath: string,
): Promise<ExecutorOutput> {
  context.logger.debug(`Using Nx adapter for ${context.command.executor}`)
  return executor(options, await createNxContext(context, pluginPackagePath))
}
