import { resolve } from 'node:path'

import { runProcess } from '../../executor/process'

import type { ExecutorContext, ExecutorResult } from '../../executor/types'

export interface ShellCommand {
  command: string
}

export interface RunCommandOptions {
  command?: string
  commands?: (string | ShellCommand)[]
  parallel?: boolean
  cwd?: string
}

export default async function runCommand(
  options: RunCommandOptions,
  context: ExecutorContext,
): Promise<ExecutorResult> {
  if (options.command !== undefined && options.commands !== undefined) {
    throw new Error('run-command accepts either command or commands, not both.')
  }

  const commands = options.commands === undefined ? [options.command] : options.commands
  if (!Array.isArray(commands) || !commands.length) {
    throw new Error('run-command requires a non-empty commands array.')
  }

  const normalized = commands.map(entry => {
    if (typeof entry === 'object' && entry !== null && !Array.isArray(entry)
      && Object.keys(entry).some(key => key !== 'command')) {
      throw new Error('run-command command objects only support the command property.')
    }

    const command = typeof entry === 'object' && entry !== null && !Array.isArray(entry) ? entry.command : entry
    if (typeof command !== 'string' || !command.trim()) {
      throw new Error('run-command requires a non-empty command string for every command.')
    }

    return command
  })
  if (options.command !== undefined && typeof options.command !== 'string') {
    throw new Error('run-command requires a non-empty command string.')
  }

  if (options.parallel !== undefined && typeof options.parallel !== 'boolean') {
    throw new Error('run-command parallel must be a boolean.')
  }

  if (options.cwd !== undefined && typeof options.cwd !== 'string') {
    throw new Error('run-command cwd must be a string.')
  }

  const run = (command: string, signal?: AbortSignal) => runProcess(command, [], {
    cwd: resolve(context.workspaceRoot, options.cwd ?? '.'),
    shell: true,
    signal,
  })

  if (options.parallel === false || normalized.length === 1) {
    for (const command of normalized) {
      const result = await run(command, context.signal)
      if (!result.success) {
        return result
      }
    }

    return { success: true }
  }

  const controller = new AbortController()
  const signal = context.signal ? AbortSignal.any([context.signal, controller.signal]) : controller.signal
  // Cancel siblings on failure and wait for all process trees to finish cleanup.
  const results = await Promise.allSettled(normalized.map(async command => {
    try {
      const result = await run(command, signal)
      if (!result.success) {
        controller.abort()
      }

      return result
    } catch (error) {
      controller.abort()
      throw error
    }
  }))
  const failure = results.find(result => result.status === 'rejected')
  if (failure?.status === 'rejected') {
    throw failure.reason
  }

  return { success: results.every(result => result.status === 'fulfilled' && result.value.success) }
}
