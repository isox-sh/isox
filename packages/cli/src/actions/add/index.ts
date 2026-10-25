import { lstat, realpath, rm } from 'node:fs/promises'
import { isAbsolute, join, relative, resolve, sep } from 'node:path'

import { findWorkspaceRoot, logger, parseWorkspace, readJson } from '@isox-sh/core'

import { loadGenerator } from '../../shared/generators'

import type { CAC } from 'cac'

async function addToProject(packageName: string, projectName: string): Promise<void> {
  const workspaceRoot = await realpath(await findWorkspaceRoot())
  const cacheDirectory = join(workspaceRoot, '.isox')
  const cacheEntry = await lstat(cacheDirectory).catch((error: NodeJS.ErrnoException) => {
    if (error.code !== 'ENOENT') {
      throw error
    }
  })

  if (cacheEntry?.isSymbolicLink()) {
    throw new Error('Cannot refresh workspace discovery through a symlinked .isox directory.')
  }

  const workspace = await parseWorkspace(workspaceRoot, { cache: false })
  const project = workspace.projects[projectName]

  if (!project) {
    throw new Error(`Project ${projectName} not found in workspace.`)
  }

  const projectRoot = await realpath(resolve(workspaceRoot, project.root))
  const path = relative(workspaceRoot, projectRoot)

  if (path === '..' || path.startsWith(`..${sep}`) || isAbsolute(path)) {
    throw new Error('The project path must be inside the Isox workspace.')
  }

  // Require an existing project and reject symlinked configuration before loading a plugin.
  await readJson('project.json', { projectRoot })
  const add = loadGenerator(packageName, 'add', workspaceRoot)

  try {
    await add({}, {
      workspaceRoot,
      projectRoot,
      projectName,
      logger
    })
  } finally {
    // A generator can partially update configuration before throwing. Always discard the old graph.
    await rm(join(cacheDirectory, 'workspace.json'), { force: true })
  }
}

export function registerAddAction(cli: CAC): void {
  cli.command('add <package> <project>', 'Add an installed plugin to an existing project')
    .example('isox add @isox-sh/semver my-package')
    .action(addToProject)
}
