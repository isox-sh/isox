import { pauseProgress } from '../logger'
import { taskHash, validateOutputs } from './hash'
import { captureOutput, replayOutput } from './output'
import { claimOutputs, clearOutputs, prepareOutputs, restoreTask, storeTask } from './store'

import type { ExecutorContext } from '../executor/types'

export interface TaskCacheOptions {
  /** Bypass both reads and writes; declared outputs remain disposable. */
  skipCache?: boolean
}

export async function runCachedTask(
  context: ExecutorContext,
  options: Record<string, unknown>,
  executorPackage: string,
  isNxExecutor: boolean,
  controls: TaskCacheOptions,
  execute: () => Promise<boolean>,
): Promise<void> {
  if (context.command.cache !== true || isNxExecutor || options.dryRun === true || context.signal?.aborted) {
    await execute()

    return
  }

  const outputs = await validateOutputs(context)
  const release = await claimOutputs(context.workspaceRoot, outputs)
  const skip = controls.skipCache || process.env.ISOX_SKIP_CACHE === '1' || options.watch === true

  try {
    const hash = skip ? undefined : await taskHash(context, options, executorPackage)

    context.signal?.throwIfAborted()

    if (hash) {
      const logs = await restoreTask(context, hash, outputs, async () => await taskHash(context, options, executorPackage) === hash)

      if (logs !== undefined) {
        const resume = pauseProgress()

        try {
          context.logger.success(`Cache hit for ${context.projectName}:${context.commandName} (${hash.slice(0, 12)}).`)
          replayOutput(logs)
        } finally {
          resume()
        }

        return
      }

      context.logger.debug(`Cache miss for ${context.projectName}:${context.commandName} (${hash}).`)
    }

    const executeWithOutputs = async () => {
      // Watch mode owns a continuing stream of builds; keep its latest outputs.
      if (options.watch === true) {
        await clearOutputs(context.workspaceRoot, outputs)

        return execute()
      }

      const transaction = await prepareOutputs(context.workspaceRoot, outputs)
      let success: boolean

      try {
        success = await execute()
      } catch (error) {
        try {
          await transaction.rollback()
        } catch (rollbackError) {
          throw new AggregateError([error, rollbackError], 'Task failed and previous outputs could not be fully restored.', { cause: rollbackError })
        }

        throw error
      }

      if (context.signal?.aborted) {
        await transaction.rollback()
      } else {
        await transaction.commit()
      }

      return success
    }

    if (!hash) {
      await executeWithOutputs()

      return
    }

    let success = false
    const start = performance.now()
    const captured = await captureOutput(async () => {
      success = await executeWithOutputs()
    })

    if (success && captured.complete && !context.signal?.aborted) {
      await storeTask(context, hash, outputs, captured.chunks, performance.now() - start, async () => await taskHash(context, options, executorPackage) === hash)
    } else if (!captured.complete) {
      context.logger.debug('Task log exceeded capture limits; result was not cached.')
    }
  } finally {
    await release()
  }
}
