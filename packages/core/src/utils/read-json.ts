import { lstat, readFile, realpath } from 'node:fs/promises'
import { join, sep } from 'node:path'

import { resolveProjectPath } from './project-path'

export interface ReadJsonContext {
  projectRoot: string
}

/** Read JSON within a project. The optional result type does not validate its shape. */
export async function readJson<T = unknown>(file: string, context: ReadJsonContext): Promise<T> {
  const { projectRoot, projectPath } = resolveProjectPath(file, context.projectRoot)
  let target = await realpath(projectRoot)
  // Match writeJson: resolve the root, but reject symlinks beneath it.
  for (const part of projectPath.split(sep)) {
    target = join(target, part)
    if ((await lstat(target)).isSymbolicLink()) {
      throw new Error(`Cannot read JSON through a symlink: ${file}`)
    }
  }

  const source = await readFile(target, 'utf8')
  try {
    return JSON.parse(source.replace(/^\uFEFF/, '')) as T
  } catch (error) {
    throw new SyntaxError(`Invalid JSON in ${file}.`, { cause: error })
  }
}
