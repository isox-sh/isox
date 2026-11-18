import { runRspack } from '../run'

import type { RspackOptions } from '../run'
import type { ExecutorContext } from '@isox-sh/core'

export default async function build(options: RspackOptions, context: ExecutorContext) {
  return runRspack('build', options, context)
}
