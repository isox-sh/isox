import { selectProjects, validateProjectCommands } from '@isox-sh/core'

import { selectionOptions, targetOptions, targetPlan } from '../../shared/options'
import { runProjects } from '../../shared/run-projects'
import { loadSelection } from '../../shared/selection'

import type { SelectionOptions, TargetOptions } from '../../shared/options'
import type { CAC } from 'cac'

export function registerAffectedAction(cli: CAC): void {
  targetOptions(selectionOptions(cli.command('affected', 'Run or print affected projects and their dependents')))
    .option('--print-matrix', 'Print a JSON array of project names without running commands')
    .example('isox affected --target=build --base=origin/main --print-matrix')
    .action(async (options: SelectionOptions & TargetOptions & { printMatrix?: boolean }) => {
      const selected = await loadSelection(options)
      const plan = targetPlan(options)
      const projects = selectProjects(selected.workspace, selected.projects, plan.target, plan.tag)
      validateProjectCommands(selected.workspace, projects, plan)
      if (options.printMatrix) {
        process.stdout.write(`${JSON.stringify(projects)}\n`)
      } else {
        await runProjects(selected.root, selected.workspace, projects, plan)
      }
    })
}
