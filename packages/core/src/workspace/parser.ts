import { readFile } from 'node:fs/promises'
import { basename, dirname, join, resolve } from 'node:path'

import { logger } from '../logger'
import { cacheVersion, readWorkspaceCache, writeWorkspaceCache } from './cache'
import { parseProjectDefinition } from './configuration'
import { discoverWorkspace } from './discovery'

import type { Logger } from '../logger'
import type { ProjectDefinition } from './configuration'

interface ParseWorkspaceOptions {
  cache?: boolean
  logger?: Logger
}

export type { ExecutorConfiguration, ProjectDefinition } from './configuration'

export interface ProjectConfiguration extends ProjectDefinition {
  name: string
  root: string
}

export interface WorkspaceGraph {
  projects: Record<string, ProjectConfiguration>
}

export async function parseWorkspace(cwd: string, options: ParseWorkspaceOptions = {}): Promise<WorkspaceGraph> {
  cwd = resolve(cwd)
  const taskLogger = options.logger ?? logger
  const cached = options.cache === false ? undefined : await readWorkspaceCache(cwd, taskLogger)

  if (cached) {
    taskLogger.debug(`Loaded workspace cache from ${join(cwd, '.isox', 'workspace.json')}`)

    return { projects: cached.projects }
  }

  const message = 'Rebuilding .isox/workspace.json...'
  const started = performance.now()
  const stop = taskLogger.progress?.(message)

  if (!stop) {
    taskLogger.info(message)
  }

  try {
    const snapshot = await discoverWorkspace(cwd)
    const projects: Record<string, ProjectConfiguration> = Object.create(null)

    for (const file of snapshot.projects) {
      const source = await readFile(join(cwd, file), 'utf8')
      let parsed: unknown

      try {
        parsed = JSON.parse(source)
      } catch (error) {
        throw new SyntaxError(`Invalid project configuration in ${file}: invalid JSON.`, { cause: error })
      }

      const content = parseProjectDefinition(parsed, file)

      const root = dirname(file)
      const name = content.name ?? basename(resolve(cwd, root))

      if (typeof name !== 'string' || !/^[^\s:]+$/.test(name)) {
        throw new Error(`Invalid project name in ${file}.`)
      }

      if (Object.hasOwn(projects, name)) {
        throw new Error(`Duplicate project name ${name} in ${file}.`)
      }

      projects[name] = {
        ...content,
        name,
        root
      }
    }

    const workspace = { projects }
    await writeWorkspaceCache(cwd, {
      version: cacheVersion,
      projects
    }, taskLogger)

    stop?.()
    const count = Object.keys(projects).length
    const duration = ((performance.now() - started) / 1000).toFixed(2)

    taskLogger.success(`Rebuilt .isox/workspace.json (${count} project${count === 1 ? '' : 's'}) in ${duration}s.`)

    return workspace
  } finally {
    stop?.()
  }
}
