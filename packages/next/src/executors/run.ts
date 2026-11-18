import { readFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'

import { resolvePackageJson, runProcess } from '@isox-sh/core'

import type { ExecutorContext, ExecutorResult } from '@isox-sh/core'

export interface BuildOptions {
  bundler?: 'turbopack' | 'webpack'
}

export interface ServerOptions {
  hostname?: string
  port?: number
}

export function bundlerArgs({ bundler }: BuildOptions): string[] {
  if (bundler === undefined) {
    return []
  }

  if (bundler !== 'turbopack' && bundler !== 'webpack') {
    throw new Error('Next.js bundler must be turbopack or webpack.')
  }

  return [`--${bundler}`]
}

export function serverArgs({ hostname, port }: ServerOptions): string[] {
  const args: string[] = []

  if (hostname !== undefined) {
    if (typeof hostname !== 'string' || !hostname.trim()) {
      throw new Error('Next.js hostname must be a non-empty string.')
    }

    args.push('--hostname', hostname)
  }

  if (port !== undefined) {
    if (!Number.isInteger(port) || port < 0 || port > 65535) {
      throw new Error('Next.js port must be an integer between 0 and 65535.')
    }

    args.push('--port', String(port))
  }

  return args
}

export async function runNext(
  command: 'build' | 'dev' | 'start',
  args: string[],
  context: ExecutorContext,
): Promise<ExecutorResult> {
  let manifestPath: string

  try {
    manifestPath = resolvePackageJson('next', context.projectRoot)
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'MODULE_NOT_FOUND') {
      throw error
    }

    throw new Error('Next.js is missing. Install next, react, and react-dom in the project or workspace.', { cause: error })
  }

  const manifest = JSON.parse(await readFile(manifestPath, 'utf8'))
  const executable = resolve(dirname(manifestPath), manifest.bin.next)

  return runProcess(process.execPath, [executable, command, ...args], {
    cwd: context.projectRoot,
    signal: context.signal,
    output: 'pipe'
  })
}
