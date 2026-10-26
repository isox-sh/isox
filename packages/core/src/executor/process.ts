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
  /** Receive structured status from a Node.js worker over a separate IPC channel. */
  onMessage?: (message: unknown) => void
  /** Handle piped output without mixing it with terminal progress. */
  onOutput?: (chunk: Buffer, stream: 'stdout' | 'stderr') => void
  /** Time before forced termination on POSIX. Wrappers must allow their children to shut down first. */
  gracePeriodMs?: number
}

/** Run a native child command and cancel its whole process tree. */
export async function runProcess(file: string, args: string[], options: RunProcessOptions): Promise<ExecutorResult> {
  if (options.signal?.aborted) {
    return { success: false }
  }

  const pipeOutput = options.output === 'pipe' || !!options.onOutput || capturingOutput()
  let resume = options.output === 'pipe' || options.onOutput ? undefined : pauseProgress()

  try {
    return await new Promise<ExecutorResult>((resolveResult, reject) => {
      const child = spawn(file, args, {
        cwd: options.cwd,
        shell: options.shell,
        env: options.env,
        stdio: options.onMessage
          ? ['inherit', pipeOutput ? 'pipe' : 'inherit', pipeOutput ? 'pipe' : 'inherit', 'ipc']
          : pipeOutput ? ['inherit', 'pipe', 'pipe'] : 'inherit',
        detached: process.platform !== 'win32',
      })
      for (const stream of ['stdout', 'stderr'] as const) {
        child[stream]?.on('data', (chunk: Buffer) => {
          if (options.onOutput) {
            options.onOutput(chunk, stream)

            return
          }

          resume ??= pauseProgress()
          process[stream].write(chunk)
        })
      }
      if (options.onMessage) {
        child.on('message', options.onMessage)
      }

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
