import { readFile } from 'node:fs/promises'
import { basename, dirname, join, resolve } from 'node:path'

import fg from 'fast-glob'

import { readWorkspaceCache, writeWorkspaceCache } from './cache'
import { parseProjectDefinition } from './configuration'

import type { ProjectDefinition } from './configuration'

export type { CommandConfiguration, ProjectDefinition } from './configuration'

export interface ProjectConfiguration extends ProjectDefinition {
  name: string
  root: string
}

export interface WorkspaceGraph {
  projects: Record<string, ProjectConfiguration>
}

export async function parseWorkspace(cwd: string): Promise<WorkspaceGraph> {
  cwd = resolve(cwd)
  const cached = await readWorkspaceCache(cwd)
  if (cached) {
    return cached
  }

  const files = await fg('**/project.json', {
    cwd,
    ignore: ['**/node_modules/**', '**/.git/**', '**/.isox/**'],
  })
  const projects: Record<string, ProjectConfiguration> = Object.create(null)

  for (const file of files.sort()) {
    const content = parseProjectDefinition(JSON.parse(await readFile(join(cwd, file), 'utf8')), file)

    const root = dirname(file)
    const name = content.name ?? basename(resolve(cwd, root))
    if (typeof name !== 'string') {
      throw new Error(`Invalid project name in ${file}.`)
    }
    if (Object.hasOwn(projects, name)) {
      throw new Error(`Duplicate project name ${name} in ${file}.`)
    }
    projects[name] = { ...content, name, root }
  }

  const workspace = { projects }
  await writeWorkspaceCache(cwd, workspace)
  return workspace
}
