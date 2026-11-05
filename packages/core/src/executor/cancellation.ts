import { spawn } from 'node:child_process'

import type { ChildProcess } from 'node:child_process'

export interface ProcessCleanup {
  (): void
  /** Resolves after cancellation has finished terminating the process tree. */
  finished: Promise<void>
}

/** Attach process-tree cancellation to a child spawned with detached: true on POSIX. */
export function handleProcessCancellation(
  child: ChildProcess,
  signal: AbortSignal | undefined,
  onError: (error: unknown) => void,
  gracePeriodMs = 2_000,
): ProcessCleanup {
  let timer: ReturnType<typeof setTimeout> | undefined
  let finish!: () => void
  const finished = new Promise<void>(resolve => {
    finish = resolve
  })
  const kill = async (force = false) => {
    if (!child.pid) {
      return
    }

    try {
      if (process.platform === 'win32') {
        await new Promise<void>(resolve => {
          const killer = spawn('taskkill', ['/pid', String(child.pid), '/T', '/F'], { stdio: 'ignore' })
          killer.once('error', () => {
            child.kill()
            resolve()
          })
          killer.once('close', () => resolve())
        })
      } else {
        process.kill(-child.pid, force ? 'SIGKILL' : 'SIGTERM')
      }
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ESRCH') {
        onError(error)
      }
    }
  }

  const abort = () => {
    if (process.platform === 'win32' || !child.pid) {
      void kill().finally(finish)

      return
    }

    void kill()
    timer = setTimeout(() => {
      void kill(true).finally(finish)
    }, gracePeriodMs)
  }

  signal?.addEventListener('abort', abort, { once: true })

  if (signal?.aborted) {
    abort()
  }

  const cleanup = () => {
    signal?.removeEventListener('abort', abort)
    // A closed launcher does not mean its descendants finished cancellation.
    if (!signal?.aborted) {
      clearTimeout(timer)
      finish()
    }
  }

  return Object.assign(cleanup, { finished })
}
