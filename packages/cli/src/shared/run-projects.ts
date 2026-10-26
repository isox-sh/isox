import { getCommandStages, logger, positiveInteger, runProcess, validateProjectCommands } from '@isox-sh/core'

import { withCancellation } from './cancellation'

import type { TargetPlanOptions, WorkspaceGraph } from '@isox-sh/core'

/** Each project gets its own CLI process: plugins may change cwd, environment, or module globals. */
export async function runProjects(root: string, workspace: WorkspaceGraph, projects: string[], options: TargetPlanOptions, optionOverrides: Record<string, unknown> = {}): Promise<void> {
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
      let next = 0
      let failure: Error | undefined
      const worker = async () => {
        while (next < queue.length && !controller.signal.aborted) {
          const name = queue[next++]

          try {
            const args = [process.argv[1], 'run']

            if (stageIndex === (options.preTargets?.length ?? 0) && Object.keys(optionOverrides).length) {
              // JSON preserves booleans, numbers, arrays, and objects across workers.
              args.push(`--options=${JSON.stringify(optionOverrides)}`)
            }

            if (stage.config !== undefined) {
              args.push(`--config=${stage.config}`)
            }

            if (process.argv.includes('--verbose')) {
              args.push('--verbose')
            }

            args.push('--', `${name}:${stage.target}`)
            // Executors get two seconds to stop their process trees before the CLI worker is killed.
            const result = await runProcess(process.execPath, args, {
              cwd: root,
              signal: controller.signal,
              // Concurrent workers share one terminal and cannot own independent spinner lines.
              env: parallel > 1 ? {
                ...process.env,
                ISOX_PROGRESS: '0'
              } : undefined,
              gracePeriodMs: 5_000
            })

            if (!result.success && !controller.signal.aborted) {
              throw new Error(`Task failed for ${name}:${stage.target}.`)
            }
          } catch (error) {
            failure ??= error instanceof Error ? error : new Error(String(error))
            controller.abort()
          }
        }
      }

      await Promise.all(Array.from({ length: Math.min(parallel, queue.length) }, worker))

      if (failure) {
        throw failure
      }
    }
  })
}
