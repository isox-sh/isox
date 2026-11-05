import { randomUUID } from 'node:crypto'
import { mkdir, readdir, realpath, rename, rm, stat, writeFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { dirname, join } from 'node:path'

import { resolvePackageJson } from '../utils/resolve-package-json'
import { digest, noSymlinks, readBoundedFile } from './files'

interface DirectoryEntry {
  signature: string
  names: string[]
}

interface ToolIndex {
  version: 1
  directories: Record<string, DirectoryEntry>
}

const maxIndexBytes = 16 * 1024 * 1024

/** Cache directory listings only. Package contents and successful resolutions stay live. */
export async function createToolIndex(root?: string) {
  let previous: ToolIndex = {
    version: 1,
    directories: {}
  }
  const directories = new Map<string, Promise<DirectoryEntry>>()
  const file = root && join(root, '.isox/tools.json')

  if (root && file) {
    try {
      await noSymlinks(root, file)
      const parsed = JSON.parse(await readBoundedFile(file, maxIndexBytes))

      if (parsed?.version === 1 && parsed.directories && typeof parsed.directories === 'object'
        && parsed.checksum === digest(JSON.stringify(parsed.directories))) {
        previous = parsed
      }
    } catch {
      // This index is optional; an unreadable or malformed file is rebuilt.
    }
  }

  const signature = async (path: string): Promise<string> => {
    try {
      const info = await stat(path, { bigint: true })

      return info.isDirectory() ? [info.dev, info.ino, info.mode, info.size, info.mtimeNs, info.ctimeNs].join(':') : 'missing'
    } catch (error) {
      if (['ENOENT', 'ENOTDIR'].includes((error as NodeJS.ErrnoException).code ?? '')) {
        return 'missing'
      }

      throw error
    }
  }

  const readDirectory = async (path: string): Promise<DirectoryEntry> => {
    const before = await signature(path)
    const cached = Object.hasOwn(previous.directories, path) ? previous.directories[path] : undefined

    if (cached?.signature === before && Array.isArray(cached.names) && cached.names.every(name => typeof name === 'string')) {
      return cached
    }

    const names = before === 'missing' ? [] : await readdir(path)

    if (await signature(path) !== before) {
      throw new Error(`Package directory changed while reading: ${path}`)
    }

    return {
      signature: before,
      names
    }
  }

  const directoryEntry = (path: string): Promise<DirectoryEntry> => {
    let pending = directories.get(path)

    if (!pending) {
      pending = readDirectory(path)
      directories.set(path, pending)
    }

    return pending
  }

  return {
    async resolveManifest(dependency: string, manifest: string): Promise<string | undefined> {
      if (!/^(?:@[^/]+\/)?[^/]+$/.test(dependency)) {
        return resolvePackageJson(dependency, dirname(manifest))
      }

      const parts = dependency.split('/')
      const paths = createRequire(manifest).resolve.paths(`${dependency}/package.json`)

      if (!paths) {
        return resolvePackageJson(dependency, dirname(manifest))
      }

      for (const directory of paths) {
        if (!(await directoryEntry(directory)).names.includes(parts[0])) {
          continue
        }

        if (parts.length === 2 && !(await directoryEntry(join(directory, parts[0]))).names.includes(parts[1])) {
          continue
        }

        // Read the physical package manifest, independent of exports and Node's
        // process-wide resolution cache, which can retain a shadowed installation.
        try {
          return await realpath(join(directory, dependency, 'package.json'))
        } catch (error) {
          if (!['ENOENT', 'ENOTDIR'].includes((error as NodeJS.ErrnoException).code ?? '')) {
            throw error
          }
        }
      }

      return undefined
    },
    async save(): Promise<void> {
      if (!root || !file) {
        return
      }

      const temporary = `${file}.${randomUUID()}.tmp`

      try {
        const entries = await Promise.all([...directories].map(async ([path, value]) => [path, await value] as const))
        const values = Object.fromEntries(entries)
        const serialized = JSON.stringify(values)

        if (serialized === JSON.stringify(previous.directories)) {
          return
        }

        const contents = JSON.stringify({
          version: 1,
          directories: values,
          checksum: digest(serialized)
        })

        if (Buffer.byteLength(contents) > maxIndexBytes) {
          return
        }

        await noSymlinks(root, file)
        await mkdir(join(root, '.isox'), { recursive: true })
        await writeFile(temporary, contents, { flag: 'wx' })
        await rename(temporary, file)
      } catch {
        // Concurrent writers can replace this advisory index; a miss just costs a scan.
      } finally {
        await rm(temporary, { force: true }).catch(() => {})
      }
    }
  }
}
