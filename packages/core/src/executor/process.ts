import { spawn } from 'node:child_process'

import type { ExecutorResult } from './types'

export interface RunProcessOptions {
  cwd: string
  shell?: boolean
  signal?: AbortSignal
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
    let timer: ReturnType<typeof setTimeout> | undefined
    const kill = (force = false) => {
      if (!child.pid) {
        return
      }

      try {
        if (process.platform === 'win32') {
          const killer = spawn('taskkill', ['/pid', String(child.pid), '/T', '/F'], { stdio: 'ignore' })
          killer.on('error', () => child.kill())
        } else {
          process.kill(-child.pid, force ? 'SIGKILL' : 'SIGTERM')
        }
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'ESRCH') {
          reject(error)
        }
      }
    }

    const abort = () => {
      kill()
      timer = setTimeout(() => kill(true), 2_000)
    }

    const cleanup = () => {
      options.signal?.removeEventListener('abort', abort)
      // The parent can exit before its descendants; finish cancelling the process group.
      if (options.signal?.aborted) {
        kill(true)
      }
      clearTimeout(timer)
    }
    options.signal?.addEventListener('abort', abort, { once: true })
    child.once('error', error => {
      cleanup()
      reject(error)
    })
    child.once('close', code => {
      cleanup()
      resolveResult({ success: code === 0 && !options.signal?.aborted })
    })
    if (options.signal?.aborted) {
      abort()
    }
  })
}
