import { defaultNamedInputs } from '../workspace/defaults'

import type { TaskInput } from '../workspace/configuration'
import type { WorkspaceGraph } from '../workspace/parser'
import type { WorkspaceSettings } from '../workspace/settings'

interface ResolvedInputs {
  projects: Map<string, TaskInput[]>
  explicitDependencies: boolean
}

/** Expand reusable inputs in the project that owns each reference. */
export function resolveTaskInputs(
  workspace: WorkspaceGraph,
  settings: WorkspaceSettings,
  projectName: string,
  inputs?: TaskInput[],
): ResolvedInputs {
  const projects = new Map<string, TaskInput[]>()
  let explicitDependencies = false

  function expand(name: string, entries: TaskInput[] | undefined, stack: string[]): void {
    const project = workspace.projects[name]

    if (!project) {
      throw new Error(`Unknown input dependency project: ${name}`)
    }

    const definitions: Record<string, TaskInput[]> = {
      ...defaultNamedInputs(),
      ...settings.namedInputs,
      ...project.namedInputs
    }
    const selected = projects.get(name) ?? []

    projects.set(name, selected)
    for (const entry of entries ?? ['default']) {
      if (typeof entry !== 'string') {
        selected.push(entry)
        continue
      }

      if (entry.startsWith('^')) {
        explicitDependencies = true
        const reference = entry.slice(1)
        const path = reference.replace(/^!/, '')
        const pending = new Set(project.dependencies ?? [])
        const visited = new Set([name])

        for (const dependency of pending) {
          if (visited.has(dependency)) {
            continue
          }

          visited.add(dependency)
          const definition = workspace.projects[dependency]
          const names = {
            ...settings.namedInputs,
            ...definition?.namedInputs
          }

          if (reference !== 'default' && !Object.hasOwn(names, reference)
            && !['{projectRoot}', '{workspaceRoot}', '{projectName}'].some(token => path.startsWith(token))) {
            throw new Error(`Unknown named input ${reference} in project ${dependency}.`)
          }

          expand(dependency, [reference], stack)
          for (const child of definition?.dependencies ?? []) {
            pending.add(child)
          }
        }

        continue
      }

      if (Object.hasOwn(definitions, entry)) {
        const key = `${name}:${entry}`

        if (stack.includes(key)) {
          throw new Error(`Named input cycle: ${[...stack, key].join(' -> ')}`)
        }

        expand(name, definitions[entry], [...stack, key])
      } else {
        // Unrecognized strings remain workspace-relative paths for compatibility.
        selected.push(entry)
      }
    }
  }

  expand(projectName, inputs, [])

  return {
    projects,
    explicitDependencies
  }
}
