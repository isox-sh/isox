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
  // Keep conventional shell exit codes while executors shut down cooperatively.
  const controller = new AbortController()
  const interrupt = () => {
    process.exitCode = 130
    controller.abort()
  }

  const terminate = () => {
    process.exitCode = 143
    controller.abort()
  }
  process.once('SIGINT', interrupt)
  process.once('SIGTERM', terminate)
  try {
    await runExecutor(workspace, projectName, commandName, workspaceRoot, logger, configurationName, controller.signal)
  } finally {
    process.removeListener('SIGINT', interrupt)
    process.removeListener('SIGTERM', terminate)
  }
}
