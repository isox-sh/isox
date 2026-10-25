import { randomUUID } from 'node:crypto'
import { lstat, mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'

import { logger } from '../logger'
import { isProjectDefinition } from './configuration'
import { isNxProjectSchema } from './nx'
import { findWorkspaceRoot } from './root'

import type { Logger } from '../logger'
import type { WorkspaceGraph } from './parser'

const cacheVersion = 8

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

function isWorkspaceCache(value: unknown): value is WorkspaceGraph & { version: number } {
  return isRecord(value)
    && value.version === cacheVersion
    && isRecord(value.projects)
    && Object.entries(value.projects).every(([name, project]) => {
      if (!isRecord(project) || project.name !== name || typeof project.root !== 'string') {
        return false
      }

      const definition = { ...project }
      delete definition.root
      return !isNxProjectSchema(definition.$schema) && isProjectDefinition(definition)
    })
}

export async function readWorkspaceCache(root: string, taskLogger: Logger = logger): Promise<WorkspaceGraph | undefined> {
  const file = join(root, '.isox', 'workspace.json')
  let content: string
  try {
    content = await readFile(file, 'utf8')
  } catch (error) {
    if (['ENOENT', 'EISDIR'].includes((error as NodeJS.ErrnoException).code ?? '')) {
      return undefined
    }
    throw error
  }

  let cached: unknown
  try {
    cached = JSON.parse(content)
  } catch {
    taskLogger.warn(`Invalid workspace cache at ${file}, rebuilding.`)
    return undefined
  }

  if (!isWorkspaceCache(cached)) {
    taskLogger.warn(`Invalid or outdated workspace cache at ${file}, rebuilding.`)
    return undefined
  }

  taskLogger.debug(`Loaded workspace cache from ${file}`)
  // Preserve the parser's dictionary semantics for names such as "__proto__".
  return { projects: Object.assign(Object.create(null), cached.projects) }
}

export async function writeWorkspaceCache(root: string, workspace: WorkspaceGraph, taskLogger: Logger = logger): Promise<void> {
  const directory = join(root, '.isox')
  const file = join(directory, 'workspace.json')
  const temporaryFile = join(directory, `workspace.${randomUUID()}.tmp`)
  await mkdir(directory, { recursive: true })
  try {
    await writeFile(temporaryFile, `${JSON.stringify({ version: cacheVersion, ...workspace }, null, 2)}\n`, { flag: 'wx' })
    try {
      if ((await lstat(file)).isDirectory()) {
        const backup = `${file}.${randomUUID()}.invalid`
        await rename(file, backup)
        taskLogger.warn(`Moved invalid workspace cache directory to ${backup}.`)
      }
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
        throw error
      }
    }
    // Publish complete JSON even when multiple processes discover the workspace.
    await rename(temporaryFile, file)
  } finally {
    await rm(temporaryFile, { force: true })
  }
  taskLogger.debug(`Saved workspace cache to ${file}`)
}

/** Remove the detected workspace's cache without rebuilding it. */
export async function resetWorkspace(startDirectory = process.cwd()): Promise<void> {
  const root = await findWorkspaceRoot(startDirectory)
  await rm(join(root, '.isox'), { recursive: true, force: true })
  logger.debug(`Removed workspace cache directory from ${root}`)
}
