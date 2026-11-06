import { posix } from 'node:path'

import { createInputMatcher, outputPaths } from '../cache/hash'
import { collectTaskInputs } from '../cache/named-inputs'
import { createTaskGraph } from '../executor/task-graph'
import { createProjectGraph } from '../workspace/graph'
import { resolveTargetDefaults } from '../workspace/target-defaults'
import { getAffectedProjects, selectProjects, workspaceFiles } from './projects'
import { getCommandStages } from './targets'

import type { WorkspaceGraph } from '../workspace/parser'
import type { WorkspaceSettings } from '../workspace/settings'
import type { TargetPlanOptions } from './types'

/** Select requested tasks using the same file selections as caching, plus prerequisites. */
export async function getAffectedTargetProjects(
  root: string,
  workspace: WorkspaceGraph,
  files: string[],
  options: TargetPlanOptions,
  settings: WorkspaceSettings = {},
): Promise<string[]> {
  workspace = resolveTargetDefaults(workspace, settings)
  const graph = createProjectGraph(workspace)
  const candidates = selectProjects(workspace, Object.keys(workspace.projects), options.target, options.tag)
  const changed = files.filter(file => !settings.affected?.ignoreFiles?.some(pattern => posix.matchesGlob(file, pattern)))
  const globals = [...workspaceFiles, ...(settings.affected?.globalFiles ?? [])]
  if (changed.some(file => globals.some(pattern => posix.matchesGlob(file, pattern)))) {
    return candidates
  }

  if (!changed.length) {
    return []
  }

  const conservative = new Set(getAffectedProjects(workspace, changed, settings.affected))
  const affectedTasks = new Map<string, boolean>()
  function affected(projectName: string, target: string): boolean {
    const key = `${projectName}:${target}`
    if (affectedTasks.has(key)) {
      return affectedTasks.get(key)!
    }

    const project = workspace.projects[projectName]
    const command = project.targets![target]
    const explicit = command.inputs !== undefined || project.namedInputs?.default !== undefined || settings.namedInputs?.default !== undefined
    if (!explicit && conservative.has(projectName)) {
      affectedTasks.set(key, true)

      return true
    }

    const selections = collectTaskInputs(workspace, settings, projectName, target, command.inputs)
    const outputs = outputPaths(command, project.root, projectName)
    const dependencies = new Set([projectName])
    for (const name of dependencies) {
      for (const dependency of graph.dependencies[name]) {
        dependencies.add(dependency)
      }
    }

    // Cache keys always include project definitions, manifests and dependency artifacts.
    const automatic: string[] = []
    for (const name of dependencies) {
      const definition = workspace.projects[name]
      automatic.push(posix.join(definition.root, 'project.json'), posix.join(definition.root, 'package.json'))
      const dependencyCommand = definition.targets?.[target]
      if (name !== projectName && dependencyCommand?.cache === true) {
        automatic.push(...outputPaths(dependencyCommand, definition.root, name))
      }
    }

    const automaticMatcher = createInputMatcher('.', automatic, outputs, projectName)
    const matches = changed.some(file => automaticMatcher.matches(file)) || [...selections].some(([name, groups]) => {
      // Preserve deepest-root ownership for an unconfigured task's own files.
      if (!explicit && name === projectName) {
        return false
      }

      const definition = workspace.projects[name]
      const dependencyCommand = definition.targets?.[target]
      const excludedOutputs = name !== projectName && dependencyCommand?.cache === true
        ? outputPaths(dependencyCommand, definition.root, name) : []

      return groups.some(inputs => {
        const matcher = createInputMatcher(definition.root, inputs, [...outputs, ...excludedOutputs], name)

        return changed.some(file => matcher.matches(file))
      })
    })
    affectedTasks.set(key, matches)

    return matches
  }

  const selected: string[] = []
  const stages = getCommandStages(options)
  for (const project of candidates) {
    const requests = stages.filter(stage => Object.hasOwn(workspace.projects[project].targets ?? {}, stage.target))
      .map(stage => ({
        project,
        target: stage.target,
        configuration: stage.config
      }))
    const tasks = await createTaskGraph(root, workspace, requests)
    if ([...tasks.values()].some(task => affected(task.project, task.target))) {
      selected.push(project)
    }
  }

  return selected
}
