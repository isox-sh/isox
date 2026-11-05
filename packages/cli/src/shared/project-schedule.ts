import { createProjectGraph, logger, resolveWorkspaceDependencies } from '@isox-sh/core'

import { runtimeBuilds } from './runtime-builds'

import type { WorkspaceGraph } from '@isox-sh/core'

/** Order selected artifact builds without adding projects or serializing independent work. */
export async function createProjectSchedule(root: string, workspace: WorkspaceGraph, projects: string[], target: string, signal: AbortSignal) {
  const pending = new Set(projects)
  const completed = new Set<string>()
  const running = new Set<string>()
  let exclusive = new Set<string>()
  const waiting = new Set<() => void>()
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

      prerequisites.set(name, new Set([...dependencies].filter(dependency => pending.has(dependency))))
    }
  }

  return {
    async next(): Promise<string | undefined> {
      while (!signal.aborted && pending.size) {
        for (const name of pending) {
          if ((exclusive.has(name) ? running.size === 0 : ![...running].some(project => exclusive.has(project)))
            && [...prerequisites.get(name) ?? []].every(dependency => completed.has(dependency))) {
            pending.delete(name)
            running.add(name)

            return name
          }
        }

        await new Promise<void>(resolve => {
          const wake = () => {
            waiting.delete(wake)
            signal.removeEventListener('abort', wake)
            resolve()
          }

          waiting.add(wake)
          signal.addEventListener('abort', wake, { once: true })
        })
      }

      return undefined
    },
    done(name: string): void {
      running.delete(name)
      completed.add(name)
      for (const wake of waiting) {
        wake()
      }
    }
  }
}
