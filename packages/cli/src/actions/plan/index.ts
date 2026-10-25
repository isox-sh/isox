import { createProjectMatrix } from '@isox-sh/core'

import { jsonValue, selectionOptions, targetOptions, targetPlan, targetPlans } from '../../shared/options'
import { loadSelection } from '../../shared/selection'

import type { SelectionOptions, TargetOptions } from '../../shared/options'
import type { CAC } from 'cac'

interface PlanActionOptions extends SelectionOptions, TargetOptions {
  targetsJson?: string
}

export function registerPlanAction(cli: CAC): void {
  targetOptions(selectionOptions(cli.command('plan', 'Print a weighted GitHub Actions matrix as JSON')))
    .option('--max-jobs <count>', 'Maximum number of shards for the target (default: 1)')
    .option('--targets-json <json>', 'Array of target settings for a multi-target plan')
    .action(async (options: PlanActionOptions) => {
      const singleTargetOptions = [
        options.target, options.tag, options.maxJobs, options.parallel,
        options.configuration, options.prod, options.preTargets, options.postTargets,
        options.preTargetsJson, options.postTargetsJson,
      ]

      if (options.targetsJson !== undefined && singleTargetOptions.some(value => value !== undefined)) {
        throw new Error('--targets-json cannot be combined with single-target options.')
      }

      const targets = options.targetsJson === undefined ? [targetPlan(options)] : targetPlans(jsonValue(options.targetsJson, '--targets-json'))
      const { workspace, projects } = await loadSelection(options)

      process.stdout.write(`${JSON.stringify(createProjectMatrix(workspace, projects, targets))}\n`)
    })
}
