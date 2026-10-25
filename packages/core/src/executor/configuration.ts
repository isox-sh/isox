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
    options: {
      ...command.options,
      ...configuration
    },
    configurationName,
  }
}
