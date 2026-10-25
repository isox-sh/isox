import { lstat, realpath, rm } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from 'node:path'

import { findWorkspaceRoot, logger, parseWorkspace, resolvePackageJson } from '@isox-sh/core'

import type { InitializerOptions, ProjectInitializer } from '@isox-sh/core'

function isInside(root: string, path: string): boolean {
  const rel = relative(root, path)

  return rel !== '' && rel !== '..' && !rel.startsWith(`..${sep}`) && !isAbsolute(rel)
}

export async function initializeProject(packageName: string, projectPath: string, options: InitializerOptions): Promise<void> {
  const workspaceRoot = await realpath(await findWorkspaceRoot())
  let projectRoot = resolve(process.cwd(), projectPath)
  // Check the nearest existing ancestor so symlinked directories cannot escape the workspace.
  let ancestor = projectRoot

  while (true) {
    try {
      await lstat(ancestor)

      if (ancestor === projectRoot) {
        throw new Error(`Cannot initialize: ${projectRoot} already exists.`)
      }

      const actual = await realpath(ancestor)

      projectRoot = resolve(actual, relative(ancestor, projectRoot))

      if (!isInside(workspaceRoot, projectRoot)) {
        throw new Error('The project path must be inside the Isox workspace and cannot be its root.')
      }

      break

    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
        throw error
      }

      ancestor = dirname(ancestor)
    }
  }

  const projectName = basename(projectRoot)

  if (!/^[^\s:]+$/.test(projectName)) {
    throw new Error(`Invalid project name: ${projectName}.`)
  }

  if (options.importPath !== undefined && (typeof options.importPath !== 'string' || !/^[^\s:*]+$/.test(options.importPath))) {
    throw new Error('--importPath must be a non-empty import name without whitespace, colons, or wildcards.')
  }

  const workspaceRequire = createRequire(join(workspaceRoot, 'package.json'))
  const packageFile = resolvePackageJson(packageName, workspaceRoot)
  const manifest = workspaceRequire(packageFile)

  if (typeof manifest.init !== 'string' || !manifest.init) {
    throw new Error(`Package ${packageName} does not define an init implementation.`)
  }

  const implementation = workspaceRequire(resolve(dirname(packageFile), manifest.init))
  const initializer: ProjectInitializer = implementation.default ?? implementation

  if (typeof initializer !== 'function') {
    throw new Error(`Initializer ${packageName} does not export a function.`)
  }

  // Refresh discovery before checking names; projects may have been added by hand.
  const cacheFile = join(workspaceRoot, '.isox', 'workspace.json')
  const workspace = await parseWorkspace(workspaceRoot, { cache: false })

  if (Object.hasOwn(workspace.projects, projectName)) {
    throw new Error(`Project ${projectName} already exists in the workspace.`)
  }

  try {
    await initializer(
      { importPath: options.importPath },
      {
        workspaceRoot,
        projectRoot,
        projectName,
        logger
      }
    )

  } finally {
    await rm(cacheFile, { force: true })
  }
}
