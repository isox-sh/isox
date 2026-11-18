import { createRequire } from 'node:module'
import { dirname, resolve } from 'node:path'

import { runProcess } from '@isox-sh/core'

import type { ExecutorContext, ExecutorResult } from '@isox-sh/core'

export interface RspackOptions {
  configFile?: string
  mode?: 'development' | 'production' | 'none'
}

export function runRspack(
  command: 'build' | 'dev',
  options: RspackOptions,
  context: ExecutorContext,
  args: string[] = [],
): Promise<ExecutorResult> {
  if (options.configFile !== undefined) {
    if (typeof options.configFile !== 'string' || !options.configFile.trim()) {
      throw new Error('Rspack configFile must be a non-empty string.')
    }

    args.push('--config', resolve(context.workspaceRoot, options.configFile))
  }

  if (options.mode !== undefined) {
    if (!['development', 'production', 'none'].includes(options.mode)) {
      throw new Error('Rspack mode must be development, production, or none.')
    }

    args.push('--mode', options.mode)
  }

  const pluginRequire = createRequire(__filename)
  const cli = pluginRequire.resolve('@rspack/cli/package.json')
  const executable = resolve(dirname(cli), pluginRequire(cli).bin.rspack)

  return runProcess(process.execPath, [executable, command, ...args], {
    cwd: context.projectRoot,
    signal: context.signal,
    output: 'pipe'
  })
}
