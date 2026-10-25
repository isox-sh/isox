import { constants } from 'node:fs'
import { lstat, open, realpath } from 'node:fs/promises'
import { join, sep } from 'node:path'

import { resolveProjectPath } from './project-path'

export interface ReadJsonContext {
  projectRoot: string
}

/** Read JSON within a project. The optional result type does not validate its shape. */
export async function readJson<T = unknown>(file: string, context: ReadJsonContext): Promise<T> {
  const { projectRoot, projectPath } = resolveProjectPath(file, context.projectRoot)
  const root = await realpath(projectRoot)
  let target = root
  const entries = []
  // Match writeJson: resolve the root, but reject symlinks beneath it.
  for (const part of projectPath.split(sep)) {
    target = join(target, part)
    const entry = await lstat(target)
    entries.push({ path: target, entry })
    if (entry.isSymbolicLink()) {
      throw new Error(`Cannot read JSON through a symlink: ${file}`)
    }
  }

  // Read the opened inode, not a pathname that can be replaced after validation.
  const handle = await open(target, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0))
  let source: string
  try {
    const opened = await handle.stat()
    const expected = entries.at(-1)!.entry
    if (opened.dev !== expected.dev || opened.ino !== expected.ino) {
      throw new Error(`JSON file changed while opening: ${file}`)
    }
    for (const { path, entry } of entries) {
      const current = await lstat(path)
      if (current.isSymbolicLink() || current.dev !== entry.dev || current.ino !== entry.ino) {
        throw new Error(`JSON path changed while opening: ${file}`)
      }
    }
    source = await handle.readFile('utf8')
  } finally {
    await handle.close()
  }
  try {
    return JSON.parse(source.replace(/^\uFEFF/, '')) as T
  } catch (error) {
    throw new SyntaxError(`Invalid JSON in ${file}.`, { cause: error })
  }
}
