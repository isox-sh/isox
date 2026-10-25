import { readFile } from 'node:fs/promises'
import { basename, dirname, join, resolve } from 'node:path'

import fg from 'fast-glob'

import { logger } from '../logger'
import { readWorkspaceCache, writeWorkspaceCache } from './cache'
import { parseProjectDefinition } from './configuration'
import { inferProjectDependencies } from './dependencies'

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
    return cached
  }

  const files = await fg('**/project.json', {
    cwd,
    dot: true,
    ignore: ['**/node_modules/**', '**/.git/**', '**/.isox/**', 'tmp/**'],
  })
  const projects: Record<string, ProjectConfiguration> = Object.create(null)

  for (const file of files.sort()) {
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

  await inferProjectDependencies(cwd, workspace)
  await writeWorkspaceCache(cwd, workspace, taskLogger)

  return workspace
}
