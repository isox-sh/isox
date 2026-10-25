import { spawn } from 'node:child_process'

import type { ChildProcess } from 'node:child_process'

/** Attach process-tree cancellation to a child spawned with detached: true on POSIX. */
export function handleProcessCancellation(
  child: ChildProcess,
  signal: AbortSignal | undefined,
  onError: (error: unknown) => void,
  gracePeriodMs = 2_000,
): () => void {
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
        onError(error)
      }
    }
  }

  const abort = () => {
    kill()
    timer = setTimeout(() => kill(true), gracePeriodMs)
    timer.unref()
  }
  signal?.addEventListener('abort', abort, { once: true })
  if (signal?.aborted) {
    abort()
  }

  // Call on both spawn errors and close: launchers can exit before their descendants.
  return () => {
    signal?.removeEventListener('abort', abort)
    if (signal?.aborted) {
      kill(true)
    }
    clearTimeout(timer)
  }
}
