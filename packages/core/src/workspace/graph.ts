import type { WorkspaceGraph } from './parser'

export interface ProjectGraph {
  dependencies: Record<string, string[]>
  dependents: Record<string, string[]>
}

/** Build edges from the supplied workspace; infer dependencies first when needed. */
export function createProjectGraph(workspace: WorkspaceGraph): ProjectGraph {
  const names = Object.keys(workspace.projects).sort()
  const dependencies: Record<string, string[]> = Object.create(null)
  const dependents: Record<string, string[]> = Object.create(null)

  for (const name of names) {
    dependencies[name] = [...new Set(workspace.projects[name].dependencies ?? [])].sort()
    dependents[name] = []
  }

  for (const name of names) {
    for (const dependency of dependencies[name]) {
      if (!Object.hasOwn(dependencies, dependency)) {
        throw new Error(`Project ${name} depends on unknown project ${dependency}. Use project names in dependencies.`)
      }

      dependents[dependency].push(name)
    }
  }

  const visited = new Set<string>()
  const active = new Set<string>()
  const path: string[] = []
  const visit = (name: string): void => {
    if (active.has(name)) {
      throw new Error(`Project dependency cycle: ${[...path.slice(path.indexOf(name)), name].join(' -> ')}`)
    }

    if (visited.has(name)) {
      return
    }

    active.add(name)
    path.push(name)
    for (const dependency of dependencies[name]) {
      visit(dependency)
    }

    path.pop()
    active.delete(name)
    visited.add(name)
  }

  names.forEach(visit)

  return {
    dependencies,
    dependents
  }
}

export function collectDependents(graph: ProjectGraph, projects: Iterable<string>): string[] {
  const affected = new Set(projects)

  // Set iteration also visits entries added during the traversal.
  for (const project of affected) {
    for (const dependent of graph.dependents[project] ?? []) {
      affected.add(dependent)
    }
  }

  return [...affected].sort()
}
