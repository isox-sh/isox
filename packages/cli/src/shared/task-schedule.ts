import { runtimeBuilds } from './runtime-builds'

import type { PlannedTask, WorkspaceGraph } from '@isox-sh/core'

export async function createTaskSchedule(root: string, workspace: WorkspaceGraph, tasks: Map<string, PlannedTask>, signal: AbortSignal) {
  const exclusive = new Set<string>()
  for (const target of new Set([...tasks.values()].map(task => task.target))) {
    const group = [...tasks.values()].filter(task => task.target === target)
    const projects = await runtimeBuilds(root, workspace, group.map(task => task.project), target)
    for (const task of group) {
      if (projects.has(task.project)) {
        exclusive.add(task.id)
      }
    }
  }

  const running = new Set<string>()
  const pending = new Map(tasks)
  const completed = new Set<string>()
  const waiting = new Set<() => void>()

  return {
    async next(): Promise<string | undefined> {
      while (!signal.aborted && pending.size) {
        for (const [id, task] of pending) {
          if ((exclusive.has(id) ? running.size === 0 : ![...running].some(id => exclusive.has(id)))
            && task.prerequisites.every(prerequisite => completed.has(prerequisite))) {
            pending.delete(id)
            running.add(id)

            return id
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
    done(id: string): void {
      running.delete(id)
      completed.add(id)
      for (const wake of waiting) {
        wake()
      }
    }
  }
}
