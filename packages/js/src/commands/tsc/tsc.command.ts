import { spawn } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, resolve } from 'node:path'

import type { ExecutorContext, ExecutorResult } from '@isox-sh/core'

export interface TscOptions {
  /** Path relative to the workspace root. Defaults to the project's tsconfig.json. */
  tsConfig?: string
}

export default async function tsc(options: TscOptions, context: ExecutorContext): Promise<ExecutorResult> {
  if (options.tsConfig !== undefined && (typeof options.tsConfig !== 'string' || !options.tsConfig.trim())) {
    throw new Error('tsc tsConfig must be a non-empty string.')
  }

  const tsConfig = options.tsConfig === undefined
    ? resolve(context.projectRoot, 'tsconfig.json')
    : resolve(context.workspaceRoot, options.tsConfig)
  // Resolve our TypeScript 7 dependency, independent of the workspace's compiler.
  const packagePath = createRequire(__filename).resolve('@typescript/native/package.json')
  const compiler = JSON.parse(readFileSync(packagePath, 'utf8'))
  const executable = resolve(dirname(packagePath), compiler.bin.tsc)

  context.logger.debug(`Compiling ${tsConfig} with TypeScript ${compiler.version}`)
  return new Promise((resolveResult, reject) => {
    const child = spawn(process.execPath, [executable, '--project', tsConfig], {
      cwd: context.workspaceRoot,
      stdio: 'inherit',
    })
    child.once('error', reject)
    child.once('close', code => resolveResult({ success: code === 0 }))
  })
}
