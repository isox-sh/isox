import { resolve } from 'node:path'

import { resolveCommandOptions } from '../executor/configuration'
import { loadExecutorPlanner } from '../executor/registry'
import { readWorkspaceSettings } from '../workspace/settings'
import { createProjectMatrix } from './plan'
import { selectProjects } from './projects'
import { positiveInteger } from './targets'

import type { WorkspaceGraph } from '../workspace/parser'
import type { MatrixEntry, TargetPlanOptions } from './types'

/** Check the JSON boundary without treating a dictionary's prototype as job data. */
function matchesJson(value: unknown, parsed: unknown): boolean {
  if (Object.is(value, parsed)) {
    return true
  }

  if (!value || typeof value !== 'object' || !parsed || typeof parsed !== 'object') {
    return false
  }

  const prototype = Object.getPrototypeOf(value)
  if (prototype !== null && prototype !== Object.getPrototypeOf(parsed)) {
    return false
  }

  const keys = Reflect.ownKeys(value).filter(key => Object.prototype.propertyIsEnumerable.call(value, key))

  return keys.length === Object.keys(parsed).length && keys.every(key =>
    Object.hasOwn(parsed, key) && matchesJson(Reflect.get(value, key), Reflect.get(parsed, key)))
}

/** Reserve fixed executor jobs, then distribute the remaining budget across projects. */
export async function planExecutorJobs(root: string, workspace: WorkspaceGraph, projects: string[], target: TargetPlanOptions): Promise<MatrixEntry[]> {
  const selected = selectProjects(workspace, projects, target.target, target.tag)
  const settings = await readWorkspaceSettings(root)
  const candidates = new Map(selected.map(projectName => {
    const project = workspace.projects[projectName]
    const command = project.targets![target.target]
    const planner = loadExecutorPlanner(command.executor, root, settings)
    const { options, configurationName } = resolveCommandOptions(command, projectName, target.target, target.config)
    const plannerOptions = command.planner ?? {}
    const requested = planner?.requestedJobs?.(options, plannerOptions)
    if (requested !== undefined) {
      positiveInteger(requested, `Requested jobs for ${projectName}:${target.target}`)
    }

    return [projectName, {
      project,
      planner,
      plannerOptions,
      options,
      configurationName,
      requested
    }] as const
  }))

  const fixed = selected.filter(name => candidates.get(name)!.requested !== undefined)
  const automatic = selected.filter(name => candidates.get(name)!.requested === undefined)
  const reserved = fixed.reduce((sum, name) => sum + candidates.get(name)!.requested!, 0)
  const minimum = reserved + (automatic.length ? 1 : 0)
  const budget = positiveInteger(target.maxJobs ?? Math.max(1, minimum), 'maxJobs')
  if (minimum > budget) {
    throw new Error(`Target ${target.target} needs at least ${minimum} jobs for the requested shards. Increase maxJobs (currently ${budget}) or reduce shards.`)
  }

  const fixedRows = fixed.flatMap(name => createProjectMatrix(workspace, [name], [target]).include)
  const automaticRows = createProjectMatrix(workspace, automatic, [{
    ...target,
    maxJobs: Math.max(1, budget - reserved)
  }]).include
  let spare = budget - reserved - automaticRows.length
  let remaining = automatic.filter(name => candidates.get(name)!.planner).length
  const jobs: MatrixEntry[] = []
  for (const row of [...fixedRows, ...automaticRows]) {
    const projectName = row.projects[0]
    const { project, planner, plannerOptions, options, configurationName, requested } = candidates.get(projectName)!
    if (!planner || (requested === undefined && !spare)) {
      jobs.push(row)
      continue
    }

    const maxJobs = requested ?? 1 + Math.ceil(spare / remaining)
    const parts = await planner(options, {
      workspaceRoot: root,
      projectRoot: resolve(root, project.root),
      projectName,
      commandName: target.target,
      configurationName,
      plannerOptions,
      maxJobs,
    })
    if (!Array.isArray(parts) || !parts.length || parts.length > maxJobs) {
      throw new Error(`Planner for ${projectName}:${target.target} must return between 1 and ${maxJobs} jobs.`)
    }

    if (requested !== undefined && parts.length !== requested) {
      throw new Error(`Planner for ${projectName}:${target.target} reserved ${requested} jobs but returned ${parts.length}.`)
    }

    for (const overrides of parts) {
      if (!overrides || typeof overrides !== 'object' || Array.isArray(overrides)) {
        throw new Error(`Planner for ${projectName}:${target.target} must return option objects.`)
      }

      // The plan crosses a JSON boundary before the worker receives its options.
      const serialized: Record<string, unknown> = JSON.parse(JSON.stringify(overrides))
      if (!matchesJson(overrides, serialized)) {
        throw new Error(`Planner for ${projectName}:${target.target} must return JSON-compatible options.`)
      }

      jobs.push({
        ...row,
        ...(Object.keys(serialized).length ? { options: serialized } : {}),
        weight: row.weight / parts.length,
      })
    }

    if (requested === undefined) {
      remaining--
      spare -= parts.length - 1
    }
  }

  return jobs.map((job, index) => ({
    ...job,
    index: index + 1,
    count: jobs.length
  }))
}
