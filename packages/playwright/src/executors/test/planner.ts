import { join } from 'node:path'

import { positiveInteger, runProcess } from '@isox-sh/core'

import { testArgs, validateShard } from './options'

import type { PlaywrightOptions } from './options'
import type { ExecutorPlannerContext } from '@isox-sh/core'

function requestedJobs(options: PlaywrightOptions, plannerOptions: Record<string, unknown>): number | undefined {
  if (options.shard !== undefined) {
    validateShard(options.shard)

    return undefined
  }

  const { shards } = plannerOptions
  if (shards === undefined || shards === 'auto') {
    return undefined
  }

  if (typeof shards !== 'number') {
    throw new Error('Playwright planner.shards must be "auto" or an integer between 1 and 256.')
  }

  return positiveInteger(shards, 'Playwright planner.shards')
}

async function plan(options: PlaywrightOptions, context: ExecutorPlannerContext) {
  if (options.shard !== undefined) {
    return [{}]
  }

  const fixed = requestedJobs(options, context.plannerOptions)
  const shards = (total: number) => Array.from({ length: total }, (_, i) => ({ shard: `${i + 1}/${total}` }))
  if (fixed !== undefined) {
    return shards(fixed)
  }

  const args = [
    ...testArgs(options, context.workspaceRoot, context.projectRoot),
    '--list', '--pass-with-no-tests', '--reporter', join(__dirname, 'count-reporter.js')
  ]
  async function countTests(shard?: string) {
    let count: number | undefined
    const result = await runProcess(process.execPath, shard ? [...args, `--shard=${shard}`] : args, {
      cwd: context.projectRoot,
      onMessage(message) {
        if (typeof message === 'number') {
          count = message
        }
      },
      onOutput: chunk => process.stderr.write(chunk),
    })
    if (!result.success || count === undefined) {
      throw new Error(`Playwright test discovery failed for ${context.projectName}.`)
    }

    return count
  }

  const testCount = await countTests()
  const total = Math.min(context.maxJobs, testCount)
  if (total < 2) {
    return [{}]
  }

  // Playwright may keep many tests together (serial suites, hooks or one large file).
  // Keep the original denominator so removing empty jobs cannot redistribute tests.
  const populated = []
  for (const part of shards(total)) {
    const count = await countTests(part.shard)
    if (count === testCount) {
      return [{}]
    }

    if (count > 0) {
      populated.push(part)
    }
  }

  return populated.length > 1 ? populated : [{}]
}

export default Object.assign(plan, { requestedJobs })
