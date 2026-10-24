import { findWorkspaceRoot, logger, parseWorkspace, runExecutor } from '@isox-sh/core'

export interface RunProjectCommandOptions {
  prod?: boolean
  configuration?: string | number
}

export async function runProjectCommand(
  commandName: string,
  projectName: string,
  options: RunProjectCommandOptions = {},
): Promise<void> {
  if (!/^[^\s:]+$/.test(commandName) || !/^[^\s:]+$/.test(projectName)) {
    throw new Error('Invalid command or project name. Use isox <command> <target>')
  }
  const selected = options.configuration
  if (selected !== undefined && typeof selected !== 'string' && typeof selected !== 'number') {
    throw new Error('Specify exactly one configuration name with --config.')
  }
  const configurationName = selected !== undefined ? String(selected) : options.prod ? 'production' : undefined
  const workspaceRoot = await findWorkspaceRoot()
  logger.debug(`Workspace root: ${workspaceRoot}`)
  // Executors may resolve relative paths against the process working directory.
  process.chdir(workspaceRoot)
  const workspace = await parseWorkspace(workspaceRoot)
  await runExecutor(workspace, projectName, commandName, workspaceRoot, logger, configurationName)
}
