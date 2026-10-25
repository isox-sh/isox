import { spawn } from 'node:child_process'

import { handleProcessCancellation } from './cancellation'

import type { ExecutorResult } from './types'

export interface RunProcessOptions {
  cwd: string
  shell?: boolean
  signal?: AbortSignal
  /** Time before forced termination on POSIX. Wrappers must allow their children to shut down first. */
  gracePeriodMs?: number
}

/** Run a native child command and cancel its whole process tree. */
export async function runProcess(file: string, args: string[], options: RunProcessOptions): Promise<ExecutorResult> {
  if (options.signal?.aborted) {
    return { success: false }
  }

  return new Promise((resolveResult, reject) => {
    const child = spawn(file, args, {
      cwd: options.cwd,
      shell: options.shell,
      stdio: 'inherit',
      detached: process.platform !== 'win32',
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
}
