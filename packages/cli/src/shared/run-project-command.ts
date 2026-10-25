import { findWorkspaceRoot, logger, parseWorkspace, runExecutor } from '@isox-sh/core'

import { withCancellation } from './cancellation'
import { configurationName } from './options'

import type { ConfigurationOptions } from './options'

export async function runProjectCommand(
  commandName: string,
  projectName: string,
  options: ConfigurationOptions = {},
): Promise<void> {
  if (!/^[^\s:]+$/.test(commandName) || !/^[^\s:]+$/.test(projectName)) {
    throw new Error('Invalid command or project name. Use isox <command> <target>')
  }

  const configuration = configurationName(options)
  const workspaceRoot = await findWorkspaceRoot()
  logger.debug(`Workspace root: ${workspaceRoot}`)
  // Executors may resolve relative paths against the process working directory.
  process.chdir(workspaceRoot)
  const workspace = await parseWorkspace(workspaceRoot)
  await withCancellation(controller =>
    runExecutor(workspace, projectName, commandName, workspaceRoot, logger, configuration, controller.signal),
  )
}
