import { stat } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'

/** Find the nearest ancestor (including the starting directory) with an isox.json file. */
export async function findWorkspaceRoot(startDirectory = process.cwd()): Promise<string> {
  let directory = resolve(startDirectory)

  while (true) {
    try {
      if ((await stat(join(directory, 'isox.json'))).isFile()) {
        return directory
      }
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code

      if (code !== 'ENOENT' && code !== 'ENOTDIR') {
        throw error
      }
    }

    const parent = dirname(directory)

    if (parent === directory) {
      throw new Error(`No Isox workspace found from ${resolve(startDirectory)}. Add isox.json to your workspace root.`)
    }

    directory = parent
  }
}
