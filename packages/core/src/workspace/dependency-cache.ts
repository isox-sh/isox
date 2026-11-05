import { createHash } from 'node:crypto'
import { readFile, stat } from 'node:fs/promises'
import { join, resolve } from 'node:path'

import ts from 'typescript'

export interface ResolutionRead {
  path: string
  kind: 'file' | 'directory' | 'content' | 'realpath'
  value: boolean | string | null
}

export interface CachedDependencies {
  sources: string
  dependencies: string[]
  reads: ResolutionRead[]
}

export interface DependencyCache {
  version: number
  configuration: string
  projects: Record<string, CachedDependencies>
}

export function fingerprint(value: unknown): string {
  return createHash('sha256').update(JSON.stringify(value)).digest('hex')
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

function isRead(value: unknown): value is ResolutionRead {
  if (!isRecord(value) || typeof value.path !== 'string') {
    return false
  }

  switch (value.kind) {
    case 'content':
      return value.value === null || typeof value.value === 'string'
    case 'realpath':
      return typeof value.value === 'string'
    case 'file':
    case 'directory':
      return typeof value.value === 'boolean'
    default:
      return false
  }
}

function isProject(value: unknown): value is CachedDependencies {
  return isRecord(value) && typeof value.sources === 'string'
    && Array.isArray(value.dependencies) && value.dependencies.every(name => typeof name === 'string')
    && Array.isArray(value.reads) && value.reads.every(isRead)
}

/** Only dependency requests open this file. Invalid metadata is safe to discard. */
export async function readDependencyCache(root: string, configuration: string): Promise<DependencyCache> {
  let cached: unknown

  try {
    cached = JSON.parse(await readFile(join(root, '.isox', 'discovery.json'), 'utf8'))
  } catch (error) {
    if (!(error instanceof SyntaxError) && !['ENOENT', 'EISDIR'].includes((error as NodeJS.ErrnoException).code ?? '')) {
      throw error
    }
  }

  if (isRecord(cached) && cached.version === 2 && cached.configuration === configuration
    && isRecord(cached.projects) && Object.values(cached.projects).every(isProject)) {
    return {
      version: 2,
      configuration,
      projects: Object.assign(Object.create(null), cached.projects)
    }
  }

  return {
    version: 2,
    configuration,
    projects: Object.create(null)
  }
}

/** File identities and change times also catch replacements and restored mtimes. */
export async function sourceFingerprint(files: string[]): Promise<string> {
  const hash = createHash('sha256')

  for (let offset = 0; offset < files.length; offset += 128) {
    const entries = await Promise.all(files.slice(offset, offset + 128).map(async file => {
      const value = await stat(file, { bigint: true })

      return [file, ...[value.dev, value.ino, value.size, value.mtimeNs, value.ctimeNs].map(String)]
    }))

    for (const entry of entries) {
      hash.update(JSON.stringify(entry))
    }
  }

  return hash.digest('hex')
}

function contentFingerprint(source: string | undefined): string | null {
  return source === undefined ? null : fingerprint(source)
}

/** Capture resolution probes outside source discovery, such as generated declarations. */
export function resolutionSystem(reads: Map<string, ResolutionRead>): ts.System {
  const record = (path: string, kind: ResolutionRead['kind'], value: ResolutionRead['value']) => {
    const absolute = resolve(path)

    reads.set(`${kind}:${absolute}`, {
      path: absolute,
      kind,
      value
    })
  }

  return {
    ...ts.sys,
    fileExists: file => {
      const exists = ts.sys.fileExists(file)

      record(file, 'file', exists)

      return exists
    },
    directoryExists: directory => {
      const exists = ts.sys.directoryExists(directory)

      record(directory, 'directory', exists)

      return exists
    },
    readFile: file => {
      const source = ts.sys.readFile(file)

      record(file, 'content', contentFingerprint(source))

      return source
    },
    realpath: file => {
      const path = ts.sys.realpath?.(file) ?? file

      record(file, 'realpath', path)

      return path
    },
  }
}

export function resolutionReadsMatch(reads: ResolutionRead[]): boolean {
  return reads.every(read => {
    switch (read.kind) {
      case 'file':
        return ts.sys.fileExists(read.path) === read.value
      case 'directory':
        return ts.sys.directoryExists(read.path) === read.value
      case 'realpath':
        return (ts.sys.realpath?.(read.path) ?? read.path) === read.value
      case 'content':
        return contentFingerprint(ts.sys.readFile(read.path)) === read.value
    }
  })
}
