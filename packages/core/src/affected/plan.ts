import { compareNames, selectProjects } from './projects'
import { positiveInteger, validateProjectCommands } from './targets'

import type { WorkspaceGraph } from '../workspace/parser'
import type { MatrixEntry, ProjectMatrix, TargetPlanOptions } from './types'

const maximumMatrixJobs = 256

function lightestShard(shards: MatrixEntry[]): MatrixEntry {
  return shards.reduce((best, shard) => {
    if (shard.weight !== best.weight) {
      return shard.weight < best.weight ? shard : best
    }

    // Fewer projects break equal loads; otherwise keep the earlier shard.
    return shard.projects.length < best.projects.length ? shard : best
  })
}

/** Greedy longest-processing-time assignment keeps expensive projects on separate workers. */
export function createProjectMatrix(workspace: WorkspaceGraph, projects: string[], targets: TargetPlanOptions[]): ProjectMatrix {
  const include: MatrixEntry[] = []

  for (const options of targets) {
    const maxJobs = positiveInteger(options.maxJobs ?? 1, 'maxJobs')
    const parallel = positiveInteger(options.parallel ?? 1, 'parallel')
    const selected = selectProjects(workspace, projects, options.target, options.tag)

    validateProjectCommands(workspace, selected, options)
    const weighted = selected.map(name => {
      const weight = workspace.projects[name].plan?.weight ?? 1

      if (!Number.isFinite(weight) || weight <= 0) {
        throw new Error(`Project ${name} plan.weight must be a finite number greater than zero.`)
      }

      return {
        name,
        weight
      }
    }).sort((a, b) => b.weight - a.weight || compareNames(a.name, b.name))

    const count = Math.min(maxJobs, selected.length)

    if (include.length + count > maximumMatrixJobs) {
      throw new Error(`The plan exceeds the GitHub Actions limit of ${maximumMatrixJobs} matrix jobs. Reduce maxJobs or split the plan.`)
    }

    const shards: MatrixEntry[] = Array.from({ length: count }, (_, index) => ({
      target: options.target,
      projects: [],
      config: options.config ?? '',
      parallel,
      preTargets: [...(options.preTargets ?? [])],
      postTargets: [...(options.postTargets ?? [])],
      tag: options.tag ?? '',
      index: index + 1,
      count,
      weight: 0,
    }))

    for (const project of weighted) {
      const shard = lightestShard(shards)

      shard.projects.push(project.name)
      shard.weight += project.weight

      if (!Number.isFinite(shard.weight)) {
        throw new Error('Combined plan.weight exceeds the supported numeric range.')
      }
    }

    for (const shard of shards) {
      shard.projects.sort()
    }

    include.push(...shards)
  }

  return { include }
}
