import { createRequire } from 'node:module'
import { dirname, resolve } from 'node:path'

import { runProcess } from '@isox-sh/core'

import type { ExecutorContext, ExecutorResult } from '@isox-sh/core'

export interface VitestOptions {
  /** Optional Vitest config path, relative to the workspace root. */
  configFile?: string
}

export default async function runVitest(options: VitestOptions, context: ExecutorContext): Promise<ExecutorResult> {
  if (options.configFile !== undefined && (typeof options.configFile !== 'string' || !options.configFile.trim())) {
    throw new Error('vitest configFile must be a non-empty string.')
  }

  const packagePath = createRequire(__filename).resolve('vitest/package.json')
  const executable = resolve(dirname(packagePath), 'vitest.mjs')
  const args = [executable, 'run', '--root', context.projectRoot]

  if (options.configFile !== undefined) {
    args.push('--config', resolve(context.workspaceRoot, options.configFile))
  }

  context.logger.debug(`Running Vitest in ${context.projectRoot}`)

  return runProcess(process.execPath, args, {
    cwd: context.projectRoot,
    signal: context.signal,
    output: 'pipe'
  })
}
