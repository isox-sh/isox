import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, resolve } from 'node:path'

import { runProcess } from '@isox-sh/core'

import type { ExecutorContext, ExecutorResult } from '@isox-sh/core'

export interface EslintOptions {
  /** Files, directories, or globs relative to the workspace root. Defaults to the project root. */
  lintFilePatterns?: string[]
  /** Configuration path relative to the workspace root, or absolute. */
  configFile?: string
  fix?: boolean
  /** Maximum allowed warnings; -1 allows unlimited warnings. Defaults to zero. */
  maxWarnings?: number
}

function validateOptions(options: EslintOptions): void {
  if (!options || typeof options !== 'object' || Array.isArray(options)
    || Object.keys(options).some(key => !['lintFilePatterns', 'configFile', 'fix', 'maxWarnings'].includes(key))) {
    throw new Error('Invalid ESLint options.')
  }

  if (options.lintFilePatterns !== undefined && (!Array.isArray(options.lintFilePatterns)
    || !options.lintFilePatterns.length || !options.lintFilePatterns.every(value => typeof value === 'string' && value.trim()))) {
    throw new Error('ESLint lintFilePatterns must be a non-empty array of non-empty strings.')
  }

  if (options.configFile !== undefined && (typeof options.configFile !== 'string' || !options.configFile.trim())) {
    throw new Error('ESLint configFile must be a non-empty string.')
  }

  if (options.fix !== undefined && typeof options.fix !== 'boolean') {
    throw new Error('ESLint fix must be a boolean.')
  }

  if (options.maxWarnings !== undefined && (!Number.isInteger(options.maxWarnings) || options.maxWarnings < -1)) {
    throw new Error('ESLint maxWarnings must be an integer greater than or equal to -1.')
  }
}

export default async function lint(options: EslintOptions, context: ExecutorContext): Promise<ExecutorResult> {
  validateOptions(options)

  const packagePath = createRequire(__filename).resolve('eslint/package.json')
  const pkg = JSON.parse(readFileSync(packagePath, 'utf8'))
  const executable = resolve(dirname(packagePath), pkg.bin.eslint)
  const args = [executable, `--max-warnings=${options.maxWarnings ?? 0}`]
  if (options.configFile !== undefined) {
    args.push('--config', resolve(context.workspaceRoot, options.configFile))
  }

  if (options.fix) {
    args.push('--fix')
  }
  args.push('--', ...(options.lintFilePatterns ?? [context.projectRoot]))

  context.logger.debug(`Running ESLint for ${context.projectRoot}`)
  return runProcess(process.execPath, args, { cwd: context.workspaceRoot, signal: context.signal })
}
