import { randomUUID } from 'node:crypto'
import { lstat, mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'

import { logger } from '../logger'
import { isProjectDefinition } from './configuration'
import { isNxProjectSchema } from './nx'
import { findWorkspaceRoot } from './root'

import type { Logger } from '../logger'
import type { WorkspaceGraph } from './parser'

export interface WorkspaceCache extends WorkspaceGraph {
  version: number
}

// Earlier formats persisted inferred edges; definitions now retain only declared dependencies.
export const cacheVersion = 12

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

function isWorkspaceCache(value: unknown): value is WorkspaceCache {
  return isRecord(value)
    && value.version === cacheVersion
    && Object.keys(value).length === 2
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

async function readCacheFile(root: string, taskLogger: Logger): Promise<unknown> {
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

  try {
    return JSON.parse(content)

  } catch {
    taskLogger.warn(`Invalid workspace cache at ${file}, rebuilding.`)

    return undefined
  }
}

export async function readWorkspaceCache(root: string, taskLogger: Logger = logger): Promise<WorkspaceCache | undefined> {
  const cached = await readCacheFile(root, taskLogger)

  if (!isWorkspaceCache(cached)) {
    if (cached !== undefined) {
      taskLogger.warn(`Invalid or outdated workspace cache at ${join(root, '.isox', 'workspace.json')}, rebuilding.`)
    }

    return undefined
  }

  // Preserve the parser's dictionary semantics for names such as "__proto__".
  return {
    ...cached,
    projects: Object.assign(Object.create(null), cached.projects)
  }
}

export async function writeWorkspaceCache(root: string, cache: WorkspaceCache, taskLogger: Logger = logger): Promise<void> {
  await writeCacheFile(root, 'workspace.json', cache, taskLogger)
}

/** Publish either cache atomically, preserving directory-shaped corrupt caches. */
export async function writeCacheFile(root: string, name: string, value: unknown, taskLogger: Logger = logger): Promise<void> {
  const directory = join(root, '.isox')
  const file = join(directory, name)
  const temporaryFile = join(directory, `${name}.${randomUUID()}.tmp`)

  await mkdir(directory, { recursive: true })

  try {
    await writeFile(temporaryFile, `${JSON.stringify(value, null, 2)}\n`, { flag: 'wx' })

    try {
      if ((await lstat(file)).isDirectory()) {
        const backup = `${file}.${randomUUID()}.invalid`

        await rename(file, backup)
        taskLogger.warn(`Moved invalid cache directory to ${backup}.`)
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

  taskLogger.debug(`Saved ${name} cache to ${file}`)
}

/** Remove the detected workspace's cache without rebuilding it. */
export async function resetWorkspace(startDirectory = process.cwd()): Promise<void> {
  const root = await findWorkspaceRoot(startDirectory)

  await rm(join(root, '.isox'), {
    recursive: true,
    force: true
  })
  logger.debug(`Removed workspace cache directory from ${root}`)
}
