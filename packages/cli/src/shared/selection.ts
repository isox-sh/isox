import { createLogger, findWorkspaceRoot, getAffectedProjects, getGitChanges, logger, parseWorkspace, readWorkspaceSettings, resolveWorkspaceDependencies } from '@isox-sh/core'

import type { SelectionOptions } from './options'

export async function loadSelection(options: SelectionOptions) {
  if (options.all && (options.base !== undefined || options.head !== undefined || options.uncommitted || options.untracked)) {
    throw new Error('--all cannot be combined with Git selection options.')
  }

  const root = await findWorkspaceRoot()
  // Plans always use current project definitions and keep diagnostic logs off JSON stdout.
  const taskLogger = createLogger({
    stdout: process.stderr,
    level: logger.level
  })
  const workspace = await parseWorkspace(root, {
    cache: false,
    logger: taskLogger
  })

  if (options.all) {
    return {
      root,
      workspace,
      projects: Object.keys(workspace.projects).sort()
    }
  }

  const changes = await getGitChanges(root, options)
  const settings = await readWorkspaceSettings(root)
  const resolved = await resolveWorkspaceDependencies(root, workspace, { logger: taskLogger })

  taskLogger.debug(`Affected comparison: ${changes.mergeBase}..${changes.head} (${changes.files.length} changed files)`)

  return {
    root,
    workspace: resolved,
    projects: getAffectedProjects(resolved, changes.files, settings.affected)
  }
}
