import { bundlerArgs, runNext, serverArgs } from '../run'

import type { BuildOptions, ServerOptions } from '../run'
import type { ExecutorContext } from '@isox-sh/core'

interface ServeOptions extends BuildOptions, ServerOptions {
  mode?: 'development' | 'production'
}

export default async function serve(options: ServeOptions, context: ExecutorContext) {
  const { mode = 'development', bundler } = options

  if (mode !== 'development' && mode !== 'production') {
    throw new Error('Next.js serve mode must be development or production.')
  }

  if (mode === 'production') {
    if (bundler !== undefined) {
      throw new Error('Select the production bundler on the Next.js build target.')
    }

    return runNext('start', serverArgs(options), context)
  }

  return runNext('dev', [...bundlerArgs(options), ...serverArgs(options)], context)
}
