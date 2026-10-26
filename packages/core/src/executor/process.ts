import { spawn } from 'node:child_process'

import { capturingOutput } from '../cache/output'
import { pauseProgress } from '../logger'
import { handleProcessCancellation } from './cancellation'

import type { ExecutorResult } from './types'

export interface RunProcessOptions {
  cwd: string
  shell?: boolean
  signal?: AbortSignal
  env?: NodeJS.ProcessEnv
  /** Pipe noninteractive tool output so progress can animate until the tool writes. */
  output?: 'inherit' | 'pipe'
  /** Time before forced termination on POSIX. Wrappers must allow their children to shut down first. */
  gracePeriodMs?: number
}

/** Run a native child command and cancel its whole process tree. */
export async function runProcess(file: string, args: string[], options: RunProcessOptions): Promise<ExecutorResult> {
  if (options.signal?.aborted) {
    return { success: false }
  }

  const pipeOutput = options.output === 'pipe' || capturingOutput()
  let resume = options.output === 'pipe' ? undefined : pauseProgress()

  try {
    return await new Promise<ExecutorResult>((resolveResult, reject) => {
      const child = spawn(file, args, {
        cwd: options.cwd,
        shell: options.shell,
        env: options.env,
        stdio: pipeOutput ? ['inherit', 'pipe', 'pipe'] : 'inherit',
        detached: process.platform !== 'win32',
      })
      child.stdout?.on('data', chunk => {
        resume ??= pauseProgress()
        process.stdout.write(chunk)
      })
      child.stderr?.on('data', chunk => {
        resume ??= pauseProgress()
        process.stderr.write(chunk)
      })
      const cleanup = handleProcessCancellation(child, options.signal, reject, options.gracePeriodMs)

      child.once('error', error => {
        cleanup()
        reject(error)
      })
      child.once('close', code => {
        cleanup()
        resolveResult({ success: code === 0 && !options.signal?.aborted })
      })
    })
  } finally {
    resume?.()
  }
}
