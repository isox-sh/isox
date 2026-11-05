import { createHash } from 'node:crypto'
import { lstat, open, readdir, readFile, realpath } from 'node:fs/promises'
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from 'node:path'

export interface FileEntry {
  path: string
  kind: 'file' | 'directory'
  mode: number
  digest?: string
}

export const digest = (value: string | Buffer): string => createHash('sha256').update(value).digest('hex')
export const slash = (value: string): string => value.split(sep).join('/')
export const inside = (root: string, path: string): boolean => {
  const part = relative(root, path)

  return part !== '..' && !part.startsWith(`..${sep}`) && !isAbsolute(part)
}

/** Bound allocation even when cache metadata is corrupt or grows during reading. */
export async function readBoundedFile(path: string, maxBytes: number): Promise<string> {
  const file = await open(path, 'r')

  try {
    const info = await file.stat()

    if (!info.isFile() || info.size > maxBytes) {
      throw new Error(`Invalid or oversized task cache metadata: ${path}`)
    }

    const buffer = Buffer.alloc(info.size + 1)
    let length = 0

    while (length < buffer.length) {
      const { bytesRead } = await file.read(buffer, length, buffer.length - length, length)

      if (!bytesRead) {
        return buffer.subarray(0, length).toString('utf8')
      }

      length += bytesRead
    }

    throw new Error(`Task cache metadata changed while reading: ${path}`)
  } finally {
    await file.close()
  }
}

export async function statIfExists(path: string) {
  try {
    return await lstat(path)
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
      throw error
    }

    return undefined
  }
}

/** Resolve existing parents too, so alternate casing cannot bypass output boundaries. */
export async function canonicalPath(path: string): Promise<string> {
  try {
    return await realpath(path)
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
      throw error
    }

    return join(await canonicalPath(dirname(path)), basename(path))
  }
}

export async function comparisonPath(path: string): Promise<string> {
  const canonical = await canonicalPath(path)

  return process.platform === 'win32' || process.platform === 'darwin' ? canonical.toLowerCase() : canonical
}

/** Check every component, including missing destinations' existing parents. */
export async function noSymlinks(root: string, path: string): Promise<void> {
  if (!inside(root, path)) {
    throw new Error(`Cache path is outside the workspace: ${path}`)
  }

  for (let part = path; ; part = resolve(part, '..')) {
    if ((await statIfExists(part))?.isSymbolicLink()) {
      throw new Error(`Symlinks are not supported in task cache paths: ${part}`)
    }

    if (part === root) {
      break
    }
  }
}

/** Sorted snapshots include modes and empty directories; never follow symlinks. */
export async function snapshot(root: string, exclude: (path: string) => boolean = () => false, include: (path: string) => boolean = () => true): Promise<FileEntry[]> {
  const entries: FileEntry[] = []
  const visit = async (path: string): Promise<void> => {
    if (exclude(path)) {
      return
    }

    const info = await statIfExists(path)

    if (!info) {
      return
    }

    if (!info.isDirectory() && !include(path)) {
      return
    }

    if (info.isSymbolicLink() || (!info.isDirectory() && !info.isFile())) {
      throw new Error(`Task cache only supports regular files and directories: ${path}`)
    }

    const entry: FileEntry = {
      path: slash(relative(root, path)),
      kind: info.isDirectory() ? 'directory' : 'file',
      mode: info.mode & 0o777,
    }

    if (info.isFile()) {
      entry.digest = digest(await readFile(path))
    }

    if (include(path)) {
      entries.push(entry)
    }

    if (info.isDirectory()) {
      for (const name of (await readdir(path)).sort()) {
        await visit(join(path, name))
      }
    }
  }

  await visit(root)

  return entries
}

/** JSON configuration key order must not influence the task key. */
export function stableJson(value: unknown): string {
  return JSON.stringify(value, (_key, item) => {
    if (item && typeof item === 'object' && !Array.isArray(item)) {
      return Object.fromEntries(Object.keys(item).sort().map(key => [key, item[key]]))
    }

    return item
  })
}
