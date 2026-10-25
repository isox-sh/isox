import { resolve } from 'node:path'

import { runProcess } from '../../executor/process'

import type { ExecutorContext, ExecutorResult } from '../../executor/types'

export interface RunCommandOptions {
  command: string
  cwd?: string
}

export default async function runCommand(
  options: RunCommandOptions,
  context: ExecutorContext,
): Promise<ExecutorResult> {
  if (typeof options.command !== 'string' || !options.command.trim()) {
    throw new Error('run-command requires a non-empty command string.')
  }

  if (options.cwd !== undefined && typeof options.cwd !== 'string') {
    throw new Error('run-command cwd must be a string.')
  }

  return runProcess(options.command, [], {
    cwd: resolve(context.workspaceRoot, options.cwd ?? '.'),
    shell: true,
    signal: context.signal,
  })
}
