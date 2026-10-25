import { constants } from 'node:fs'
import { copyFile, link } from 'node:fs/promises'

/** Publish a prepared file without replacing an entry created by another writer. */
export async function publishNewFile(source: string, destination: string): Promise<void> {
  try {
    await link(source, destination)
  } catch (error) {
    if (!['ENOSYS', 'ENOTSUP', 'EOPNOTSUPP', 'EXDEV', 'EPERM'].includes((error as NodeJS.ErrnoException).code ?? '')) {
      throw error
    }

    // Some filesystems cannot hard-link. Exclusive copying retains no-overwrite
    // semantics, although publication there cannot be atomic.
    await copyFile(source, destination, constants.COPYFILE_EXCL)
  }
}
