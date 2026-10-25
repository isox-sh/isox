import { createHash, randomUUID } from 'node:crypto'
import { lstat, mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'

import fg from 'fast-glob'

import { canonical, inside, slash } from '../../helpers/files'

import type { CompilerConfig } from './compiler'
import type { ExecutorContext } from '@isox-sh/core'

export { canonical, existingFile, inside, slash } from '../../helpers/files'

export const hash = (value: string | Buffer) => createHash('sha256').update(value).digest('hex')

export async function atomicWrite(path: string, data: string | Buffer): Promise<void> {
  await mkdir(dirname(path), { recursive: true })
  const temporary = `${path}.${randomUUID()}.tmp`
  try {
    await writeFile(temporary, data, { flag: 'wx' })
    await rename(temporary, path)
  } finally {
    await rm(temporary, { force: true })
  }
}

export async function safeDestination(path: string, roots: string[]): Promise<void> {
  const actual = await canonical(path)
  const actualRoots = await Promise.all(roots.map(canonical))
  if (!roots.some((root, index) => inside(root, path) && inside(actualRoots[index], actual))) {
    throw new Error(`Unsafe output path: ${path}`)
  }
  // Do not follow even an internal symlink when writing or deleting output.
  for (let part = path;roots.some(root => inside(root, part));part = dirname(part)) {
    try {
      if ((await lstat(part)).isSymbolicLink()) {
        throw new Error(`Symlink in output path: ${part}`)
      }
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
        throw error
      }
    }

    if (roots.includes(part)) {
      break
    }
  }
}

export async function outputRoots(config: CompilerConfig, tsConfig: string, context: ExecutorContext): Promise<string[]> {
  const options = config.compilerOptions
  if (options.outFile) {
    throw new Error('tsc outFile is unsupported; use outDir in tsconfig.json.')
  }

  if (!options.outDir && !options.noEmit) {
    throw new Error('tsc requires outDir in tsconfig.json to keep generated files separate from sources.')
  }

  const roots = [...new Set([options.outDir, options.declarationDir].filter((value): value is string => !!value)
    .map(value => resolve(dirname(tsConfig), value)))]
  const workspace = await canonical(context.workspaceRoot)
  const project = await canonical(context.projectRoot)
  const sources = await Promise.all((config.files ?? []).map(file => canonical(resolve(dirname(tsConfig), file))))
  for (const root of roots) {
    const actual = await canonical(root)
    if (
      !inside(workspace, actual)
      || !inside(workspace, root)
      || inside(actual, project)
      || inside(actual, await canonical(tsConfig))
      || sources.some(file => inside(actual, file))
      || inside(resolve(workspace, '.isox'), actual)
      || slash(actual).split('/').includes('node_modules')
    ) {
      throw new Error(`Unsafe output directory: ${root}`)
    }

    for (const other of Object.values(context.workspace?.projects ?? {})) {
      const otherRoot = await canonical(resolve(workspace, other.root))
      if (otherRoot !== project && otherRoot !== workspace && (inside(otherRoot, actual) || inside(actual, otherRoot))) {
        throw new Error(`Output directory overlaps project ${other.name}: ${root}`)
      }
    }

    for (let part = root; inside(workspace, part) && part !== workspace; part = dirname(part)) {
      try {
        if ((await lstat(part)).isSymbolicLink()) {
          throw new Error(`Symlink in output path: ${part}`)
        }
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
          throw error
        }
      }
    }
    await safeDestination(root, roots)
  }

  return roots.filter(root => !roots.some(other => other !== root && inside(other, root)))
}

export interface OutputState {
  version: 1
  project: string
  config: string
  roots: string[]
  files: Record<string, string>
}

export function statePath(context: ExecutorContext): string {
  return join(context.workspaceRoot, '.isox', 'tsc', `${hash(context.projectRoot)}.json`)
}

export async function loadState(path: string): Promise<OutputState | undefined> {
  try {
    const value = JSON.parse(await readFile(path, 'utf8'))
    if (
      !value
      || typeof value !== 'object'
      || value.version !== 1
      || typeof value.project !== 'string'
      || typeof value.config !== 'string'
      || !Array.isArray(value.roots)
      || !value.roots.every((root: unknown) => typeof root === 'string')
      || !value.files
      || typeof value.files !== 'object'
      || Array.isArray(value.files)
      || !Object.values(value.files).every(digest => typeof digest === 'string')
    ) {
      throw new Error(`Invalid TypeScript output state: ${path}. Run isox reset to discard it.`)
    }

    return value as OutputState
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      return undefined
    }
    throw error
  }
}

export async function checkOwners(path: string, roots: string[], context: ExecutorContext): Promise<void> {
  const directory = dirname(path)
  const actualRoots = await Promise.all(roots.map(canonical))
  for (const file of await fg(['*.json', '*.claim'], { cwd: directory, absolute: true })) {
    if (file === path) {
      continue
    }

    // A completed build publishes state before removing its in-progress claim.
    // If the claim disappears after the directory scan, inspect that state instead.
    const other = await loadState(file)
      ?? (file.endsWith('.claim') ? await loadState(file.slice(0, -'.claim'.length)) : undefined)
    if (!other || other.project === context.projectRoot) {
      continue
    }

    const otherRoots = await Promise.all(other.roots.map(canonical))
    const overlaps = actualRoots.some(root => otherRoots.some(otherRoot =>
      inside(root, otherRoot) || inside(otherRoot, root),
    ))
    if (overlaps) {
      throw new Error(`Output directory overlaps TypeScript output owned by ${other.project}.`)
    }
  }
}

export async function removeOwned(previous: OutputState | undefined, keep: Set<string>, roots: string[]): Promise<void> {
  for (const [file, digest] of Object.entries(previous?.files ?? {})) {
    if (keep.has(file)) {
      continue
    }
    // A changed output location does not authorize removing the former location.
    if (!roots.some(root => inside(root, file))) {
      continue
    }

    await safeDestination(file, roots)
    try {
      if (hash(await readFile(file)) === digest) {
        await rm(file)
      }
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
        throw error
      }
    }
  }
}
