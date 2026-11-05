import { minimatch } from 'minimatch'

import { resolveWorkspaceDependencies } from '../workspace/dependencies'
import { resolveCommandOptions } from './configuration'

import type { WorkspaceGraph } from '../workspace/parser'

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
  const requested = new Map(requests.map(request => {
    const command = workspace.projects[request.project]?.targets?.[request.target]
    const configuration = request.configuration ?? command?.defaultConfiguration

    return [[request.project, request.target, configuration].filter(value => value !== undefined).join(':'), request]
  }))
  let resolved: Promise<WorkspaceGraph> | undefined
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
    const id = [request.project, request.target, configurationName].filter(value => value !== undefined).join(':')
    if (visiting.includes(id)) {
      throw new Error(`Task dependency cycle: ${[...visiting, id].join(' -> ')}`)
    }

    if (tasks.has(id)) {
      return id
    }

    request = requested.get(id) ?? request
    const task: PlannedTask = {
      ...request,
      configuration: configurationName,
      id,
      prerequisites: []
    }
    visiting.push(id)
    for (const entry of command.dependsOn ?? []) {
      const dependency = typeof entry === 'string'
        ? entry.startsWith('^') ? {
          target: entry.slice(1),
          dependencies: true
        } : { target: entry }
        : entry
      let names: string[]
      let target = dependency.target
      if (dependency.dependencies) {
        resolved ??= resolveWorkspaceDependencies(root, workspace)
        names = (await resolved).projects[request.project].dependencies ?? []
      } else if (dependency.projects !== undefined) {
        const patterns = typeof dependency.projects === 'string' ? [dependency.projects] : dependency.projects
        names = Object.keys(workspace.projects).filter(name => patterns.some(pattern => minimatch(name, pattern)))
      } else if (target.includes(':')) {
        const separator = target.indexOf(':')
        names = [target.slice(0, separator)]
        target = target.slice(separator + 1)
      } else {
        names = [request.project]
      }

      const traversed = new Set<string>()
      const addProject = async (name: string): Promise<void> => {
        if (traversed.has(name)) {
          return
        }

        traversed.add(name)
        const candidate = Object.hasOwn(workspace.projects, name) ? workspace.projects[name] : undefined
        if (!candidate) {
          throw new Error(`Project ${name} not found in workspace.`)
        }

        const targets = Object.keys(candidate.targets ?? {}).filter(name => minimatch(name, target))
        for (const targetName of targets) {
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
        // Nx traverses projects without this target to find prerequisites further upstream.
        if (!targets.length && dependency.dependencies) {
          for (const upstream of (await resolved!).projects[name].dependencies ?? []) {
            await addProject(upstream)
          }
        }
      }

      for (const name of names) {
        await addProject(name)
      }
    }

    visiting.pop()
    task.prerequisites = [...new Set(task.prerequisites)]
    tasks.set(id, task)

    return id
  }

  for (const request of requests) {
    await visit(request)
  }

  return tasks
}
