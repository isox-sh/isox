import { minimatch } from 'minimatch'

import { resolveWorkspaceDependencies } from '../workspace/dependencies'
import { resolveCommandOptions } from './configuration'

import type { TargetDependency, WorkspaceGraph } from '../workspace/parser'

export interface TaskRequest {
  project: string
  target: string
  configuration?: string
  overrides?: Record<string, unknown>
}

export interface PlannedTask extends TaskRequest {
  id: string
  prerequisites: string[]
}

/** Expand and validate the entire pipeline before executing any task. */
export async function createTaskGraph(root: string, workspace: WorkspaceGraph, requests: TaskRequest[]): Promise<Map<string, PlannedTask>> {
  const tasks = new Map<string, PlannedTask>()
  const visiting: string[] = []
  const requestedTasks = new Map(requests.map(request => {
    const command = workspace.projects[request.project]?.targets?.[request.target]
    const configuration = request.configuration ?? command?.defaultConfiguration

    return [taskId(request.project, request.target, configuration), request]
  }))
  let dependencyWorkspace: Promise<WorkspaceGraph> | undefined
  const resolveDependencies = () => dependencyWorkspace ??= resolveWorkspaceDependencies(root, workspace)
  const visit = async (request: TaskRequest): Promise<string> => {
    const project = Object.hasOwn(workspace.projects, request.project) ? workspace.projects[request.project] : undefined
    if (!project) {
      throw new Error(`Project ${request.project} not found in workspace.`)
    }

    const command = Object.hasOwn(project.targets ?? {}, request.target) ? project.targets![request.target] : undefined
    if (!command) {
      throw new Error(`Command ${request.target} not found in project ${request.project}.`)
    }

    const { configurationName, options } = resolveCommandOptions(command, request.project, request.target, request.configuration)
    const id = taskId(request.project, request.target, configurationName)
    if (visiting.includes(id)) {
      throw new Error(`Task dependency cycle: ${[...visiting, id].join(' -> ')}`)
    }

    // Explicit CLI values win when a task is both requested and a prerequisite.
    const requestedTask = requestedTasks.get(id)
    if (requestedTask) {
      request = {
        ...request,
        ...requestedTask,
        overrides: {
          ...request.overrides,
          ...requestedTask.overrides
        },
      }
    }

    const existing = tasks.get(id)
    if (existing) {
      existing.overrides = {
        ...request.overrides,
        ...existing.overrides
      }

      return id
    }

    const task: PlannedTask = {
      ...request,
      configuration: configurationName,
      id,
      prerequisites: []
    }
    visiting.push(id)
    for (const entry of command.dependsOn ?? []) {
      const dependency = normalizeDependency(entry)
      let projectNames: string[]
      let targetPattern = dependency.target
      if (dependency.dependencies) {
        projectNames = (await resolveDependencies()).projects[request.project].dependencies ?? []
      } else if (dependency.projects !== undefined) {
        const patterns = typeof dependency.projects === 'string' ? [dependency.projects] : dependency.projects
        projectNames = Object.keys(workspace.projects).filter(name => patterns.some(pattern => minimatch(name, pattern)))
      } else if (targetPattern.includes(':')) {
        const separator = targetPattern.indexOf(':')
        projectNames = [targetPattern.slice(0, separator)]
        targetPattern = targetPattern.slice(separator + 1)
      } else {
        projectNames = [request.project]
      }

      const visitedProjects = new Set<string>()
      const addProject = async (name: string): Promise<void> => {
        if (visitedProjects.has(name)) {
          return
        }

        visitedProjects.add(name)
        const candidate = Object.hasOwn(workspace.projects, name) ? workspace.projects[name] : undefined
        if (!candidate) {
          throw new Error(`Project ${name} not found in workspace.`)
        }

        const matchingTargets = Object.keys(candidate.targets ?? {}).filter(name => minimatch(name, targetPattern))
        for (const targetName of matchingTargets) {
          const definition = candidate.targets![targetName]
          const configuration = configurationName !== undefined && Object.hasOwn(definition.configurations ?? {}, configurationName)
            ? configurationName : undefined
          const prerequisite = await visit({
            project: name,
            target: targetName,
            configuration,
            overrides: {
              ...(dependency.options === 'forward' ? options : {}),
              ...(dependency.params === 'forward' ? request.overrides : {}),
            }
          })
          task.prerequisites.push(prerequisite)
        }
        // Projects without this target can still lead to upstream prerequisites.
        if (!matchingTargets.length && dependency.dependencies) {
          for (const upstream of (await resolveDependencies()).projects[name].dependencies ?? []) {
            await addProject(upstream)
          }
        }
      }

      for (const name of projectNames) {
        await addProject(name)
      }
    }

    visiting.pop()
    task.prerequisites = [...new Set(task.prerequisites)]
    // Insertion order lets direct runs execute prerequisites before their consumers.
    tasks.set(id, task)

    return id
  }

  for (const request of requests) {
    await visit(request)
  }

  return tasks
}

function taskId(project: string, target: string, configuration?: string): string {
  return [project, target, configuration].filter(value => value !== undefined).join(':')
}

function normalizeDependency(entry: string | TargetDependency): TargetDependency {
  if (typeof entry !== 'string') {
    return entry
  }

  if (entry.startsWith('^')) {
    return {
      target: entry.slice(1),
      dependencies: true
    }
  }

  return { target: entry }
}
