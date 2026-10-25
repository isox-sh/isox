import { mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { dirname, join, relative, resolve, sep } from 'node:path'

import { json, writeJson } from '@isox-sh/core'
import { applyEdits, modify, parse } from 'jsonc-parser'

import type { ProjectInitializer } from '@isox-sh/core'
import type { ParseError } from 'jsonc-parser'

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

function relativePath(from: string, to: string): string {
  const path = relative(from, to).split(sep).join('/')
  return path.startsWith('.') ? path : `./${path}`
}

const init: ProjectInitializer = async (options, context) => {
  const { workspaceRoot, projectRoot, projectName } = context
  const baseFile = join(workspaceRoot, 'tsconfig.base.json')
  let source: string
  let createBase = false
  try {
    source = await readFile(baseFile, 'utf8')
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
      throw error
    }
    createBase = true
    source = json({
      compilerOptions: {
        target: 'ES2022', module: 'NodeNext', moduleResolution: 'NodeNext',
        strict: true, declaration: true, skipLibCheck: true,
      }
    })
  }

  const errors: ParseError[] = []
  const config: unknown = parse(source, errors, { allowTrailingComma: true })
  if (errors.length || !isRecord(config)
    || (config.compilerOptions !== undefined && !isRecord(config.compilerOptions))) {
    throw new Error(`Invalid TypeScript configuration in ${baseFile}.`)
  }

  const compilerOptions = (config.compilerOptions ?? {}) as Record<string, unknown>
  if (options.importPath !== undefined) {
    const paths = compilerOptions.paths ?? {}
    if (!isRecord(paths) || (compilerOptions.baseUrl !== undefined && typeof compilerOptions.baseUrl !== 'string')) {
      throw new Error(`Invalid compilerOptions.paths or baseUrl in ${baseFile}.`)
    }

    if (Object.hasOwn(paths, options.importPath)) {
      throw new Error(`Import path ${options.importPath} already exists in ${baseFile}.`)
    }

    const pathsRoot = resolve(workspaceRoot, (compilerOptions.baseUrl as string | undefined) ?? '.')
    source = applyEdits(source, modify(source, ['compilerOptions', 'paths', options.importPath], [
      relativePath(pathsRoot, join(projectRoot, 'src/index.ts')),
    ], { formattingOptions: { insertSpaces: true, tabSize: 2, eol: source.includes('\r\n') ? '\r\n' : '\n' } }))
  }

  await mkdir(dirname(projectRoot), { recursive: true })
  await mkdir(projectRoot)
  try {
    await mkdir(join(projectRoot, 'src'))
    await writeJson('project.json', {
      name: projectName,
      executors: {
        build: {
          executor: '@isox-sh/js:tsc',
          options: { tsConfig: relativePath(workspaceRoot, join(projectRoot, 'tsconfig.build.json')) },
        },
      },
      tags: [],
    }, context, { overwrite: false })
    await writeJson('tsconfig.json', {
      extends: relativePath(projectRoot, baseFile),
      compilerOptions: {
        noEmit: true,
        composite: false,
        rootDir: relativePath(projectRoot, workspaceRoot),
      },
      include: ['src/**/*.ts'],
    }, context, { overwrite: false })
    await writeJson('tsconfig.build.json', {
      extends: relativePath(projectRoot, baseFile),
      compilerOptions: {
        noEmit: false,
        rootDir: './src',
        outDir: relativePath(projectRoot, join(workspaceRoot, 'dist', relative(workspaceRoot, projectRoot))),
      },
      include: ['src/**/*.ts'],
    }, context, { overwrite: false })
    await writeFile(join(projectRoot, 'src/index.ts'), 'export {}\n', { flag: 'wx' })
    if (createBase || options.importPath !== undefined) {
      await writeFile(baseFile, source, { flag: createBase ? 'wx' : 'w' })
    }
  } catch (error) {
    await rm(projectRoot, { recursive: true, force: true })
    throw error
  }
}

export default init
