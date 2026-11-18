import { bundlerArgs, runNext } from '../run'

import type { BuildOptions } from '../run'
import type { ExecutorContext } from '@isox-sh/core'

export default async function build(options: BuildOptions, context: ExecutorContext) {
  return runNext('build', bundlerArgs(options), context)
}
