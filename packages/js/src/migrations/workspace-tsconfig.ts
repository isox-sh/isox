import { lstat, readFile, rm, writeFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { isDeepStrictEqual } from 'node:util'

import { parseWorkspace } from '@isox-sh/core'
import { applyEdits, modify, parse } from 'jsonc-parser'

import { prepareWorkspaceTsconfig, projectSchema, relativePath } from '../generators/workspace-tsconfig'

import type { MigrationContext } from '@isox-sh/core'
import type { ParseError } from 'jsonc-parser'

export default async function migrate({ workspaceRoot, logger }: MigrationContext): Promise<void> {
  const workspace = await parseWorkspace(workspaceRoot, {
    cache: false,
    logger
  })
  const roots: string[] = []
  const obsolete: string[] = []
  const schemas = new Map<string, string>()

  for (const project of Object.values(workspace.projects)) {
    const root = resolve(workspaceRoot, project.root)
    const projectFile = join(root, 'project.json')
    const source = await readFile(projectFile, 'utf8')
    const config = JSON.parse(source)

    if (config.$schema === undefined) {
      schemas.set(projectFile, applyEdits(source, modify(source, ['$schema'], projectSchema(workspaceRoot, root), {
        formattingOptions: {
          insertSpaces: true,
          tabSize: 2,
          eol: source.includes('\r\n') ? '\r\n' : '\n'
        }
      })))
    }

    const build = project.targets?.build

    if (root === workspaceRoot || !build || !['js:tsc', '@isox-sh/js:tsc'].includes(build.executor)
      || typeof build.options?.tsConfig !== 'string'
      || resolve(workspaceRoot, build.options.tsConfig) !== join(root, 'tsconfig.build.json')) {
      continue
    }

    // A customized build may extend the local editor config; keep that dependency intact.
    const buildConfig = parse(await readFile(join(root, 'tsconfig.build.json'), 'utf8'))

    if (buildConfig?.extends !== relativePath(root, join(workspaceRoot, 'tsconfig.base.json'))) {
      continue
    }

    const file = join(root, 'tsconfig.json')

    try {
      const entry = await lstat(file)
      const expected = {
        extends: relativePath(root, join(workspaceRoot, 'tsconfig.base.json')),
        compilerOptions: {
          noEmit: true,
          composite: false,
          rootDir: relativePath(root, workspaceRoot),
        },
        include: ['src/**/*.ts'],
      }

      const errors: ParseError[] = []
      const actual = entry.isFile() ? parse(await readFile(file, 'utf8'), errors, { allowTrailingComma: true }) : undefined

      if (errors.length || !isDeepStrictEqual(actual, expected)) {
        logger.info(`Keeping customized editor configuration: ${file}`)
        continue
      }

      obsolete.push(file)
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
        throw error
      }
    }

    roots.push(root)
  }

  if (roots.length) {
    const writeEditorConfig = await prepareWorkspaceTsconfig(workspaceRoot, roots)

    await writeEditorConfig()
  }

  for (const [file, source] of schemas) {
    await writeFile(file, source)
  }

  for (const file of obsolete) {
    await rm(file)
  }
}
