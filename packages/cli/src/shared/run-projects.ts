import { getCommandStages, logger, LogLevels, positiveInteger, runProcess, validateProjectCommands } from '@isox-sh/core'

import { withCancellation } from './cancellation'
import { createProjectSchedule } from './project-schedule'
import { createTaskDisplay } from './task-display'

import type { TargetPlanOptions, TaskCacheOptions, WorkspaceGraph } from '@isox-sh/core'

/** Each project gets its own CLI process: plugins may change cwd, environment, or module globals. */
export async function runProjects(root: string, workspace: WorkspaceGraph, projects: string[], options: TargetPlanOptions, optionOverrides: Record<string, unknown> = {}, cacheOptions: TaskCacheOptions = {}): Promise<void> {
  const parallel = positiveInteger(options.parallel ?? 1, 'parallel')

  validateProjectCommands(workspace, projects, options)

  if (!projects.length) {
    logger.info('No projects to run.')

    return
  }

  await withCancellation(async controller => {
    for (const [stageIndex, stage] of getCommandStages(options).entries()) {
      if (controller.signal.aborted) {
        break
      }

      const queue = projects.filter(name => Object.hasOwn(workspace.projects[name].targets ?? {}, stage.target))

      if (!queue.length) {
        continue
      }

      const verbose = logger.level >= LogLevels.debug
      const schedule = await createProjectSchedule(root, workspace, queue, stage.target, controller.signal)
      const display = verbose ? undefined : createTaskDisplay({
        target: stage.target,
        total: queue.length
      })

      if (!display?.interactive) {
        logger.info(`Running target ${stage.target} for ${queue.length} project${queue.length === 1 ? '' : 's'}:\n\n${queue.map(name => `   - ${name}`).join('\n')}\n`)
      }

      let failure: Error | undefined
      const worker = async () => {
        while (!controller.signal.aborted) {
          const name = await schedule.next()

          if (name === undefined) {
            return
          }

          const configuration = stage.config ?? workspace.projects[name].targets?.[stage.target].defaultConfiguration
          const reference = [name, stage.target, configuration].filter(value => value !== undefined).join(':')
          let success: boolean

          display?.start(name, reference)

          try {
            const args = [process.argv[1], 'run']

            if (stageIndex === (options.preTargets?.length ?? 0) && Object.keys(optionOverrides).length) {
              // JSON preserves booleans, numbers, arrays, and objects across workers.
              args.push(`--options=${JSON.stringify(optionOverrides)}`)
            }

            if (stage.config !== undefined) {
              args.push(`--config=${stage.config}`)
            }

            if (verbose) {
              args.push('--verbose')
            }

            if (cacheOptions.skipCache) {
              args.push('--skip-cache')
            }

            args.push('--', `${name}:${stage.target}`)
            // Executors get two seconds to stop their process trees before the CLI worker is killed.
            const result = await runProcess(process.execPath, args, {
              cwd: root,
              signal: controller.signal,
              // The parent presents task results received over IPC.
              env: {
                ...process.env,
                ISOX_PROGRESS: '0',
                ISOX_TASK_OUTPUT: display ? 'live' : ''
              },
              onMessage: display ? message => display.message(name, message) : undefined,
              onOutput: display ? (chunk, stream) => display.output(name, chunk, stream) : undefined,
              gracePeriodMs: 5_000
            })
            success = result.success

            if (!result.success && !controller.signal.aborted) {
              throw new Error(`Task failed for ${name}:${stage.target}.`)
            }
          } catch (error) {
            display?.finish(name, false, controller.signal.aborted)
            failure ??= error instanceof Error ? error : new Error(String(error))
            controller.abort()

            return
          } finally {
            schedule.done(name)
          }

          display?.finish(name, success, controller.signal.aborted)
        }
      }

      try {
        await Promise.all(Array.from({ length: Math.min(parallel, queue.length) }, worker))
      } finally {
        display?.stop()
      }

      if (failure) {
        throw failure
      }
    }
  })
}
