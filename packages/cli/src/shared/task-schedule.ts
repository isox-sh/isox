import { runtimeBuilds } from './runtime-builds'
import { createSchedule } from './schedule'

import type { PlannedTask, WorkspaceGraph } from '@isox-sh/core'

export async function createTaskSchedule(root: string, workspace: WorkspaceGraph, tasks: Map<string, PlannedTask>, signal: AbortSignal) {
  const plannedTasks = [...tasks.values()]
  const exclusive = new Set<string>()
  const writesOutputs = plannedTasks.some(task => {
    const command = workspace.projects[task.project].targets![task.target]

    return command.cache === true && Boolean(command.outputs?.length)
  })
  if (writesOutputs && tasks.size > 1) {
    for (const target of new Set(plannedTasks.map(task => task.target))) {
      const group = plannedTasks.filter(task => task.target === target)
      const projects = await runtimeBuilds(root, workspace, group.map(task => task.project), target)
      for (const task of group) {
        if (projects.has(task.project)) {
          exclusive.add(task.id)
        }
      }
    }
  }

  const prerequisites = new Map([...tasks].map(([id, task]) => [id, new Set(task.prerequisites)]))

  return createSchedule(tasks.keys(), prerequisites, exclusive, signal)
}
