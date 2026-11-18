import { runProcess } from '@isox-sh/core'

import { testArgs, validateShard } from './options'

import type { PlaywrightOptions } from './options'
import type { ExecutorContext } from '@isox-sh/core'

export default async function test(options: PlaywrightOptions, context: ExecutorContext) {
  const args = testArgs(options, context.workspaceRoot, context.projectRoot)
  if (options.shard !== undefined) {
    validateShard(options.shard)
    args.push(`--shard=${options.shard}`)
  }

  return runProcess(process.execPath, args, {
    cwd: context.projectRoot,
    signal: context.signal,
    output: 'pipe'
  })
}
