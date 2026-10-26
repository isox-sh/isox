import { AsyncLocalStorage } from 'node:async_hooks'

export interface TerminalChunk {
  stream: 'stdout' | 'stderr'
  data: string
}

export interface CapturedOutput {
  chunks: TerminalChunk[]
  complete: boolean
}

interface CaptureState {
  output: CapturedOutput
  bytes: number
  active: boolean
  parent?: CaptureState
}

const storage = new AsyncLocalStorage<CaptureState>()
const limit = 16 * 1024 * 1024
const maxChunks = 65_536
let captures = 0
let restore: (() => void) | undefined

export function capturingOutput(): boolean {
  return storage.getStore()?.active === true
}

/** Async-local routing isolates simultaneous tasks without capturing unrelated logs. */
export async function captureOutput(run: () => Promise<void>): Promise<CapturedOutput> {
  if (captures++ === 0) {
    const originals = [process.stdout.write, process.stderr.write]

    for (const [index, name] of (['stdout', 'stderr'] as const).entries()) {
      const stream = process[name]
      const original = originals[index]

      stream.write = function (chunk: string | Uint8Array, encoding?: BufferEncoding | ((error?: Error | null) => void), callback?: (error?: Error | null) => void) {
        const state = storage.getStore()
        if (state) {
          const buffer = typeof chunk === 'string' ? Buffer.from(chunk, typeof encoding === 'string' ? encoding : undefined) : chunk
          let data: string | undefined
          // A parent executor must replay its children's logs too. Sibling tasks
          // still have separate async-local chains.
          for (let current: CaptureState | undefined = state; current; current = current.parent) {
            const captured = current.output

            if (!current.active || !captured.complete || !buffer.length) {
              continue
            }

            // Bound both payload bytes and object overhead from tiny writes.
            if ((current.bytes += buffer.length) > limit || captured.chunks.length >= maxChunks) {
              captured.complete = false
              captured.chunks.length = 0
            } else {
              data ??= Buffer.from(buffer).toString('base64')
              captured.chunks.push({
                stream: name,
                data
              })
            }
          }
        }

        return typeof encoding === 'function' ? original.call(stream, chunk, undefined, encoding) : original.call(stream, chunk, encoding, callback)
      }
    }

    restore = () => {
      process.stdout.write = originals[0]
      process.stderr.write = originals[1]
    }
  }

  const captured: CapturedOutput = {
    chunks: [],
    complete: true
  }

  const state: CaptureState = {
    output: captured,
    bytes: 0,
    active: true,
    parent: storage.getStore()
  }

  try {
    await storage.run(state, run)

    return captured
  } finally {
    state.active = false

    if (--captures === 0) {
      restore?.()
      restore = undefined
    }
  }
}

export function replayOutput(chunks: TerminalChunk[]): void {
  for (const chunk of chunks) {
    process[chunk.stream].write(Buffer.from(chunk.data, 'base64'))
  }
}
