import { createTaskGraph, getCommandStages, logger, LogLevels, positiveInteger, runProcess, validateProjectCommands } from '@isox-sh/core'

import { withCancellation } from './cancellation'
import { createProjectSchedule } from './project-schedule'
import { createTaskDisplay } from './task-display'
import { createTaskSchedule } from './task-schedule'

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

      const overrides = stageIndex === (options.preTargets?.length ?? 0) ? optionOverrides : {}
      const hasDependencies = queue.some(name => workspace.projects[name].targets?.[stage.target].dependsOn?.length)
      const tasks = hasDependencies ? await createTaskGraph(root, workspace, queue.map(project => ({
        project,
        target: stage.target,
        configuration: stage.config,
        overrides,
      }))) : undefined
      const total = tasks?.size ?? queue.length
      const verbose = logger.level >= LogLevels.debug
      const schedule = tasks ? await createTaskSchedule(root, workspace, tasks, controller.signal) : await createProjectSchedule(root, workspace, queue, stage.target, controller.signal)
      const display = verbose ? undefined : createTaskDisplay({
        target: stage.target,
        total
      })

      if (verbose) {
        logger.info(`Running target ${stage.target} for ${queue.length} project${queue.length === 1 ? '' : 's'}:\n\n${queue.map(name => `   - ${name}`).join('\n')}\n`)
      }

      let failure: Error | undefined
      const worker = async () => {
        while (!controller.signal.aborted) {
          const name = await schedule.next()

          if (name === undefined) {
            return
          }

          const task = tasks?.get(name)
          const projectName = task?.project ?? name
          const target = task?.target ?? stage.target
          const configuration = task?.configuration ?? (task ? undefined : stage.config ?? workspace.projects[name].targets?.[stage.target].defaultConfiguration)
          const taskOverrides = task?.overrides ?? overrides
          const reference = [projectName, target, configuration].filter(value => value !== undefined).join(':')
          let success: boolean

          display?.start(name, reference)

          try {
            const args = [process.argv[1], 'run']

            if (Object.keys(taskOverrides).length) {
              // JSON preserves booleans, numbers, arrays, and objects across workers.
              args.push(`--options=${JSON.stringify(taskOverrides)}`)
            }

            if (configuration !== undefined) {
              args.push(`--config=${configuration}`)
            }

            if (verbose) {
              args.push('--verbose')
            }

            if (cacheOptions.skipCache) {
              args.push('--skip-cache')
            }

            args.push('--', `${projectName}:${target}`)
            // Executors get two seconds to stop their process trees before the CLI worker is killed.
            const result = await runProcess(process.execPath, args, {
              cwd: root,
              signal: controller.signal,
              // The parent presents task results received over IPC.
              env: {
                ...process.env,
                ISOX_SCHEDULED_TASK: tasks ? '1' : '',
                ISOX_PROGRESS: '0',
                ISOX_TASK_OUTPUT: display ? 'live' : ''
              },
              onMessage: display ? message => display.message(name, message) : undefined,
              onOutput: display ? (chunk, stream) => display.output(name, chunk, stream) : undefined,
              gracePeriodMs: 5_000
            })
            success = result.success

            if (!result.success && !controller.signal.aborted) {
              throw new Error(`Task failed for ${reference}.`)
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
        await Promise.all(Array.from({ length: Math.min(parallel, total) }, worker))
      } finally {
        display?.stop()
      }

      if (failure) {
        throw failure
      }
    }
  })
}
