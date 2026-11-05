import { jsonValue } from './options'

import type { CAC } from 'cac'

type Command = ReturnType<CAC['command']>

/** Execution commands reserve orchestration flags and pass all others to the executor. */
export function executionOptions(command: Command): Command {
  return command
    .allowUnknownOptions()
    .option('--skip-cache', 'Execute without reading or writing task results')
    .option('--options <json>', 'Executor option overrides as a JSON object')
}

export function getExecutorOverrides(cli: CAC): Record<string, unknown> {
  const definitions = [...cli.globalCommand.options, ...(cli.matchedCommand?.options ?? [])]
  const reserved = new Set(['--', ...definitions.flatMap(option => option.names)])
  const flags = Object.fromEntries(Object.entries(cli.options).filter(([name]) => !reserved.has(name)))
  const encoded = cli.options.options
  const overrides = encoded === undefined ? {} : jsonValue(encoded, '--options')

  if (overrides === null || typeof overrides !== 'object' || Array.isArray(overrides)) {
    throw new Error('--options must contain a JSON object.')
  }

  return {
    ...overrides,
    ...flags
  }
}
