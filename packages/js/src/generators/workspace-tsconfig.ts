import { randomUUID } from 'node:crypto'
import { constants, existsSync } from 'node:fs'
import { chmod, lstat, open, readFile, rename, rm, writeFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { join, relative, sep } from 'node:path'

import { json, publishNewFile } from '@isox-sh/core'
import { applyEdits, modify, parse } from 'jsonc-parser'

import type { ParseError } from 'jsonc-parser'

export function relativePath(from: string, to: string): string {
  const path = relative(from, to).split(sep).join('/')

  return path.startsWith('.') ? path : `./${path}`
}

interface CoreManifest {
  version: string
}

export function projectSchema(workspaceRoot: string, projectRoot: string): string {
  const local = join(workspaceRoot, 'node_modules/@isox-sh/core/schemas/project.schema.json')

  if (existsSync(local)) {
    return relativePath(projectRoot, local)
  }

  // pnpm need not expose transitive dependencies at the workspace root.
  const { version } = createRequire(__filename)('@isox-sh/core/package.json') as CoreManifest

  return `https://unpkg.com/@isox-sh/core@${version}/schemas/project.schema.json`
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

interface WorkspaceTsconfigUpdate {
  (): Promise<void>
  rollback(): Promise<void>
}

/** Validate and prepare before creating a project or removing its old editor config. */
export async function prepareWorkspaceTsconfig(workspaceRoot: string, projectRoots: string[]): Promise<WorkspaceTsconfigUpdate> {
  const file = join(workspaceRoot, 'tsconfig.json')
  let original: string | undefined
  let mode: number | undefined

  try {
    const entry = await lstat(file)

    if (entry.isSymbolicLink()) {
      throw new Error(`Cannot update TypeScript configuration through a symlink: ${file}`)
    }

    mode = entry.mode & 0o777
    const handle = await open(file, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0))

    try {
      original = await handle.readFile('utf8')
    } finally {
      await handle.close()
    }
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
      throw error
    }
  }

  let source = original ?? json({
    extends: './tsconfig.base.json',
    include: []
  })
  const errors: ParseError[] = []
  const config: unknown = parse(source, errors, { allowTrailingComma: true })

  if (errors.length || !isRecord(config)
    || (config.compilerOptions !== undefined && !isRecord(config.compilerOptions))
    || (config.include !== undefined && (!Array.isArray(config.include) || !config.include.every(value => typeof value === 'string')))) {
    throw new Error(`Invalid TypeScript configuration in ${file}.`)
  }

  const set = (path: string[], value: unknown) => {
    source = applyEdits(source, modify(source, path, value, {
      formattingOptions: {
        insertSpaces: true,
        tabSize: 2,
        eol: source.includes('\r\n') ? '\r\n' : '\n'
      }
    }))
  }

  if (config.extends === undefined) {
    set(['extends'], './tsconfig.base.json')
  }

  set(['compilerOptions', 'noEmit'], true)
  set(['compilerOptions', 'composite'], false)
  set(['compilerOptions', 'rootDir'], '.')
  // Preserve the implicit all-files selection of an existing config without files/include.
  const include = (config.include ?? (original !== undefined && config.files === undefined ? ['**/*'] : [])) as string[]
  const additions = projectRoots.map(root => `${relativePath(workspaceRoot, root)}/src/**/*.ts`)

  set(['include'], [...new Set([...include, ...additions])])

  let applied = false
  const write = async () => {
    if (source === original) {
      return
    }

    const temporary = `${file}.${randomUUID()}.tmp`

    try {
      await writeFile(temporary, source, {
        flag: 'wx',
        mode
      })

      if (mode !== undefined) {
        await chmod(temporary, mode)
      }

      if (original === undefined) {
        await publishNewFile(temporary, file)
      } else {
        await rename(temporary, file)
      }

      applied = true
    } finally {
      await rm(temporary, { force: true })
    }
  }

  const rollback = async () => {
    if (!applied) {
      return
    }

    // Do not replace a config changed by another writer after our update.
    try {
      if ((await lstat(file)).isSymbolicLink() || await readFile(file, 'utf8') !== source) {
        return
      }
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
        return
      }

      throw error
    }

    if (original === undefined) {
      await rm(file)

      return
    }

    const temporary = `${file}.${randomUUID()}.tmp`

    try {
      await writeFile(temporary, original, {
        flag: 'wx',
        mode
      })
      if (mode !== undefined) {
        await chmod(temporary, mode)
      }

      await rename(temporary, file)
    } finally {
      await rm(temporary, { force: true })
    }
  }

  return Object.assign(write, { rollback })
}
