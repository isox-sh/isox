import { realpath } from 'node:fs/promises'
import { isAbsolute, relative, resolve, sep } from 'node:path'

import { valid } from 'semver'

import { readReleaseFile } from '../../helpers/files'

import type { ExecutorContext } from '@isox-sh/core'

interface Manifest extends Record<string, unknown> {
  name: string
  version: string
}

export interface ReleaseProject {
  root: string
  path: string
  manifest: Manifest
}

export function repositoryPath(repositoryRoot: string, root: string): string {
  const path = relative(repositoryRoot, root).split(sep).join('/')

  if (path === '..' || path.startsWith('../') || isAbsolute(path)) {
    throw new Error('Release project must be inside the Git repository.')
  }

  return path || '.'
}

/** Sync releases include the root manifest and discovered projects that declare a version. */
export async function releaseProjects(context: ExecutorContext, repositoryRoot: string, sync: boolean): Promise<ReleaseProject[]> {
  const roots = sync
    ? [context.workspaceRoot, ...Object.values(context.workspace.projects).map(project => resolve(context.workspaceRoot, project.root))]
    : [context.projectRoot]
  const projects: ReleaseProject[] = []
  const seen = new Set<string>()

  for (const directory of roots) {
    const root = await realpath(directory)
    const path = repositoryPath(repositoryRoot, root)

    if (seen.has(root)) {
      continue
    }

    seen.add(root)
    const source = await readReleaseFile(root, 'package.json', sync)

    if (!source) {
      continue
    }

    const manifest = JSON.parse(source) as Manifest

    if (sync && manifest && typeof manifest === 'object' && !Array.isArray(manifest) && manifest.version === undefined) {
      continue
    }

    if (!manifest || typeof manifest !== 'object' || Array.isArray(manifest)
      || typeof manifest.name !== 'string' || !manifest.name.trim()
      || typeof manifest.version !== 'string' || valid(manifest.version) !== manifest.version) {
      throw new Error(`Release requires a package.json with a name and a valid semantic version: ${root}`)
    }

    projects.push({
      root,
      path,
      manifest
    })
  }

  if (!projects.length) {
    throw new Error('Release requires at least one package.json with a name and a valid semantic version.')
  }

  return projects
}
