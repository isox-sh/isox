import type { ExecutorConfiguration } from '../workspace/parser'

export function resolveCommandOptions(
  command: ExecutorConfiguration,
  projectName: string,
  commandName: string,
  requestedConfiguration?: string,
) {
  const configurationName = requestedConfiguration ?? command.defaultConfiguration

  if (configurationName === undefined) {
    return {
      options: { ...command.options },
      configurationName
    }
  }

  if (typeof configurationName !== 'string' || !/^[^\s:,]+$/.test(configurationName)) {
    throw new Error('Invalid configuration name. Specify one non-empty name without whitespace, colons, or commas.')
  }

  if (!Object.hasOwn(command.configurations ?? {}, configurationName)) {
    throw new Error(`Configuration ${configurationName} not found for ${projectName}:${commandName}.`)
  }

  const configuration = command.configurations?.[configurationName]

  if (!configuration || typeof configuration !== 'object' || Array.isArray(configuration)) {
    throw new Error(`Configuration ${configurationName} for ${projectName}:${commandName} must be an object.`)
  }

  return {
    // Match Nx: configuration values replace base values, including objects and arrays.
    options: mergeExecutorOptions(command.executor, command.options ?? {}, configuration),
    configurationName,
  }
}

/** A shell command override replaces the inherited single/array command shape. */
export function mergeExecutorOptions(executor: string, base: Record<string, unknown>, override: Record<string, unknown>): Record<string, unknown> {
  const merged = {
    ...base,
    ...override
  }
  if (/^(?:@isox-sh\/)?core:run-commands?$/.test(executor)) {
    if (Object.hasOwn(override, 'command') && !Object.hasOwn(override, 'commands')) {
      delete merged.commands
    } else if (Object.hasOwn(override, 'commands') && !Object.hasOwn(override, 'command')) {
      delete merged.command
    }
  }

  return merged
}
