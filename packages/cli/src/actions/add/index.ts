import { lstat, realpath, rm } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path'

import { findWorkspaceRoot, logger, parseWorkspace, readJson, resolvePackageJson } from '@isox-sh/core'

import type { ProjectAdder } from '@isox-sh/core'
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
  const workspaceRequire = createRequire(join(workspaceRoot, 'package.json'))
  const packageFile = resolvePackageJson(packageName, workspaceRoot)
  const manifest = workspaceRequire(packageFile)

  if (typeof manifest.add !== 'string' || !manifest.add) {
    throw new Error(`Package ${packageName} does not define an add implementation.`)
  }

  const implementation = workspaceRequire(resolve(dirname(packageFile), manifest.add))
  const add: ProjectAdder = implementation.default ?? implementation

  if (typeof add !== 'function') {
    throw new Error(`Add generator ${packageName} does not export a function.`)
  }

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
