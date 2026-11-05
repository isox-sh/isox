import { createProjectGraph, logger, resolveWorkspaceDependencies } from '@isox-sh/core'

import { runtimeBuilds } from './runtime-builds'
import { createSchedule } from './schedule'

import type { WorkspaceGraph } from '@isox-sh/core'

/** Order selected artifact builds without adding projects or serializing independent work. */
export async function createProjectSchedule(root: string, workspace: WorkspaceGraph, projects: string[], target: string, signal: AbortSignal) {
  const selectedProjects = new Set(projects)
  let exclusive = new Set<string>()
  const prerequisites = new Map<string, Set<string>>()
  const writesOutputs = projects.some(name => {
    const command = workspace.projects[name].targets?.[target]

    return command?.cache === true && Boolean(command.outputs?.length)
  })

  if (writesOutputs && projects.length > 1) {
    const resolved = await resolveWorkspaceDependencies(root, workspace, {
      projects,
      logger
    })

    exclusive = await runtimeBuilds(root, workspace, projects, target)
    const graph = createProjectGraph(resolved)
    for (const name of projects) {
      const dependencies = new Set(graph.dependencies[name])

      for (const dependency of dependencies) {
        for (const transitive of graph.dependencies[dependency]) {
          dependencies.add(transitive)
        }
      }

      prerequisites.set(name, new Set([...dependencies].filter(dependency => selectedProjects.has(dependency))))
    }
  }

  return createSchedule(projects, prerequisites, exclusive, signal)
}
