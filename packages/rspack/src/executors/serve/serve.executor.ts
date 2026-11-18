import { runRspack } from '../run'

import type { RspackOptions } from '../run'
import type { ExecutorContext } from '@isox-sh/core'

interface ServeOptions extends RspackOptions {
  port?: number
}

export default async function serve(options: ServeOptions, context: ExecutorContext) {
  const args = []

  if (options.port !== undefined) {
    if (!Number.isInteger(options.port) || options.port < 0 || options.port > 65535) {
      throw new Error('Rspack port must be an integer between 0 and 65535.')
    }

    args.push('--port', String(options.port))
  }

  return runRspack('dev', options, context, args)
}
