import { lstat, readFile } from 'node:fs/promises'
import { join } from 'node:path'

/** Release only regular project files; never rewrite a symlink's destination. */
export async function readReleaseFile(root: string, name: string, optional = false): Promise<string> {
  const path = join(root, name)

  try {
    const entry = await lstat(path)

    if (!entry.isFile() || entry.isSymbolicLink()) {
      throw new Error(`Release file must be a regular file: ${path}`)
    }

    return await readFile(path, 'utf8')
  } catch (error) {
    if (optional && (error as NodeJS.ErrnoException).code === 'ENOENT') {
      return ''
    }

    throw error
  }
}
