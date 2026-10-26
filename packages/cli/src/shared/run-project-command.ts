import { createLogger, findWorkspaceRoot, logger, parseWorkspace, runExecutor } from '@isox-sh/core'

import { withCancellation } from './cancellation'
import { configurationName } from './options'

import type { ConfigurationOptions } from './options'

export async function runProjectCommand(
  commandName: string,
  projectName: string,
  options: ConfigurationOptions = {},
  optionOverrides: Record<string, unknown> = {},
): Promise<void> {
  if (!/^[^\s:]+$/.test(commandName) || !/^[^\s:]+$/.test(projectName)) {
    throw new Error('Invalid command or project name. Use isox <command> <target>')
  }

  const configuration = configurationName(options)
  const taskOutput = process.env.ISOX_TASK_OUTPUT
  const taskLogger = taskOutput === 'compact' || taskOutput === 'live'
    ? createLogger({
      level: logger.level,
      taskOutput: 'compact'
    })
    : logger
  // This is a worker presentation setting, not an environment input for tools or nested CLIs.
  delete process.env.ISOX_TASK_OUTPUT
  if (taskOutput === 'live' && process.send) {
    taskLogger.task = (message, status = 'success') => {
      if (process.connected) {
        process.send?.({
          type: 'isox:task-result',
          message,
          status
        }, () => {})
      }
    }
  }

  const workspaceRoot = await findWorkspaceRoot()

  logger.debug(`Workspace root: ${workspaceRoot}`)
  // Executors may resolve relative paths against the process working directory.
  process.chdir(workspaceRoot)
  const workspace = await parseWorkspace(workspaceRoot)

  await withCancellation(controller =>
    runExecutor(workspace, projectName, commandName, workspaceRoot, taskLogger, configuration, controller.signal, optionOverrides, { skipCache: options.skipCache }),
  )
}
