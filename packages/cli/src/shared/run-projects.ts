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
    // Validate every stage before pre-targets can create side effects.
    const stages = await planStages(root, workspace, projects, options, optionOverrides)

    for (const { stage, queue, overrides, tasks } of stages) {
      if (controller.signal.aborted) {
        break
      }

      if (!queue.length) {
        continue
      }

      const prerequisiteIds = new Set(Array.from(tasks?.values() ?? []).flatMap(task => task.prerequisites))
      const total = tasks?.size ?? queue.length
      const verbose = logger.level >= LogLevels.debug
      const schedule = tasks
        ? await createTaskSchedule(root, workspace, tasks, controller.signal)
        : await createProjectSchedule(root, workspace, queue, stage.target, controller.signal)
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
          const id = await schedule.next()

          if (id === undefined) {
            return
          }

          const task = tasks?.get(id)
          const projectName = task?.project ?? id
          const target = task?.target ?? stage.target
          const configuration = task
            ? task.configuration
            : stage.config ?? workspace.projects[projectName].targets?.[target].defaultConfiguration
          const taskOverrides = task?.overrides ?? overrides
          const reference = [projectName, target, configuration].filter(value => value !== undefined).join(':')
          let scheduledTask = ''
          if (tasks) {
            scheduledTask = prerequisiteIds.has(id) ? 'prerequisite' : '1'
          }

          let success: boolean

          display?.start(id, reference)

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
            // Give executors time to stop their child processes before killing the worker.
            const result = await runProcess(process.execPath, args, {
              cwd: root,
              signal: controller.signal,
              // The parent presents task results received over IPC.
              env: {
                ...process.env,
                ISOX_SCHEDULED_TASK: scheduledTask,
                ISOX_PROGRESS: '0',
                ISOX_TASK_OUTPUT: display ? 'live' : ''
              },
              onMessage: display ? message => display.message(id, message) : undefined,
              onOutput: display ? (chunk, stream) => display.output(id, chunk, stream) : undefined,
              gracePeriodMs: 5_000
            })
            success = result.success

            if (!result.success && !controller.signal.aborted) {
              throw new Error(`Task failed for ${reference}.`)
            }
          } catch (error) {
            display?.finish(id, false, controller.signal.aborted)
            failure ??= error instanceof Error ? error : new Error(String(error))
            controller.abort()

            return
          } finally {
            schedule.done(id)
          }

          display?.finish(id, success, controller.signal.aborted)
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

async function planStages(root: string, workspace: WorkspaceGraph, projects: string[], options: TargetPlanOptions, optionOverrides: Record<string, unknown>) {
  const stages = []
  for (const [stageIndex, stage] of getCommandStages(options).entries()) {
    const queue = projects.filter(name => Object.hasOwn(workspace.projects[name].targets ?? {}, stage.target))

    const overrides = stageIndex === (options.preTargets?.length ?? 0) ? optionOverrides : {}
    const hasDependencies = queue.some(name => workspace.projects[name].targets?.[stage.target].dependsOn?.length)
    const tasks = hasDependencies ? await createTaskGraph(root, workspace, queue.map(project => ({
      project,
      target: stage.target,
      configuration: stage.config,
      overrides,
    }))) : undefined
    stages.push({
      stage,
      queue,
      overrides,
      tasks
    })
  }

  return stages
}
