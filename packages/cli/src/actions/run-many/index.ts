import { createLogger, findWorkspaceRoot, logger, parseWorkspace, selectProjects } from '@isox-sh/core'

import { executionOptions, getExecutorOverrides } from '../../shared/executor-options'
import { jsonValue, projectList, stringList, targetOptions, targetPlan } from '../../shared/options'
import { runProjects } from '../../shared/run-projects'

import type { TargetOptions } from '../../shared/options'
import type { CAC } from 'cac'

interface RunManyActionOptions extends TargetOptions {
  projects?: string
  projectsJson?: string
}

export function registerRunManyAction(cli: CAC): void {
  executionOptions(targetOptions(cli.command('run-many', 'Run a command on an explicit project list or all projects')))
    .option('--projects <names>', 'Comma-separated project names (default: all matching projects)')
    .option('--projects-json <json>', 'Exact JSON project list from a plan; no filtering or redistribution')
    .action(async (options: RunManyActionOptions) => {
      if (options.projects !== undefined && options.projectsJson !== undefined) {
        throw new Error('Use either --projects or --projects-json.')
      }

      if (options.projectsJson !== undefined && options.tag !== undefined) {
        throw new Error('--projects-json is an exact plan and cannot be combined with --tag.')
      }

      const root = await findWorkspaceRoot()
      const workspace = await parseWorkspace(root, {
        cache: false,
        logger: createLogger({
          stdout: process.stderr,
          level: logger.level
        })
      })

      const plan = targetPlan(options)
      let projects: string[]

      if (options.projectsJson !== undefined) {
        projects = projectList(jsonValue(options.projectsJson, '--projects-json'))

      } else {
        const candidates = options.projects === undefined ? Object.keys(workspace.projects) : projectList(stringList(options.projects))

        projects = selectProjects(workspace, candidates, plan.target, plan.tag)
      }

      await runProjects(root, workspace, projects, plan, getExecutorOverrides(cli))
    })
}
