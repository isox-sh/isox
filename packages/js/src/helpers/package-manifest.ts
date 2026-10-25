import { basename, dirname, resolve } from 'node:path'

import { readJson } from '@isox-sh/core'

import type { PackageJsonContext } from './package-json'

export type Json = null | boolean | number | string | Json[] | { [key: string]: Json }
export type Manifest = Record<string, Json>
export const versionPattern = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-(?:0|[1-9]\d*|[0-9A-Za-z-]*[A-Za-z-][0-9A-Za-z-]*)(?:\.(?:0|[1-9]\d*|[0-9A-Za-z-]*[A-Za-z-][0-9A-Za-z-]*))*)?(?:\+[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?(?![\s\S])/

export async function readManifest(path: string): Promise<Manifest> {
  const value = await readJson<Manifest>(basename(path), { projectRoot: dirname(path) })
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`Invalid package manifest: ${path}`)
  }
  return value
}

export async function optionalManifest(path: string): Promise<Manifest | undefined> {
  try {
    return await readManifest(path)
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
      throw error
    }
    return undefined
  }
}

export function defaultManifest(directory: string, context: PackageJsonContext, root: Manifest): Manifest {
  const project = Object.values(context.workspace?.projects ?? {})
    .find(project => resolve(context.workspaceRoot, project.root) === resolve(directory))
  return {
    name: project?.name ?? basename(directory),
    version: typeof root.version === 'string' ? root.version : '0.0.0',
  }
}
