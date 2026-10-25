import { randomUUID } from 'node:crypto'
import { chmod, lstat, mkdir, realpath, rename, rm, writeFile } from 'node:fs/promises'
import { basename, dirname, join, relative, resolve, sep } from 'node:path'

import { logger } from '../logger'
import { json } from './json'
import { resolveProjectPath } from './project-path'
import { publishNewFile } from './publish-new-file'

import type { Logger } from '../logger'

export interface WriteJsonContext {
  projectRoot: string
  workspaceRoot?: string
  logger?: Logger
}

export interface WriteJsonOptions {
  /** Replace an existing file. Set to false when scaffolding new files. */
  overwrite?: boolean
}

/** Write formatted JSON inside an existing project and log the action and relative path. */
export async function writeJson(
  file: string,
  value: unknown,
  context: WriteJsonContext,
  options: WriteJsonOptions = {},
): Promise<void> {
  const { projectRoot, destination, projectPath } = resolveProjectPath(file, context.projectRoot)
  const source = json(value)

  // Resolve the project itself, but never follow symlinks within it.
  const root = await realpath(projectRoot)
  let directory = root
  const parents = projectPath.split(sep).slice(0, -1)
  for (const part of parents) {
    directory = join(directory, part)
    try {
      await mkdir(directory)
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'EEXIST') {
        throw error
      }
    }

    const entry = await lstat(directory)
    if (entry.isSymbolicLink() || !entry.isDirectory()) {
      throw new Error(`JSON path must use project directories, without symlinks: ${file}`)
    }
  }

  const target = join(directory, basename(destination))
  let existed = false
  let mode: number | undefined
  try {
    const entry = await lstat(target)
    mode = entry.mode & 0o777
    if (entry.isSymbolicLink()) {
      throw new Error(`Cannot write JSON through a symlink: ${file}`)
    }
    existed = true
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
      throw error
    }
  }

  const temporary = join(dirname(target), `.${basename(target)}.${randomUUID()}.tmp`)
  try {
    await writeFile(temporary, source, { flag: 'wx', mode })
    if (mode !== undefined) {
      await chmod(temporary, mode)
    }
    if (options.overwrite === false) {
      // Publish without replacing a file created by another writer.
      await publishNewFile(temporary, target)
    } else {
      // Replace the entry atomically, without modifying hard-linked files elsewhere.
      await rename(temporary, target)
    }
  } finally {
    await rm(temporary, { force: true })
  }

  const path = relative(resolve(context.workspaceRoot ?? projectRoot), destination).split(sep).join('/')
  const taskLogger = context.logger ?? logger
  taskLogger.success(`${existed ? 'Updated' : 'Created'} file ${path}`)
}
