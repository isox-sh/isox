import { readFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { setTimeout as delay } from 'node:timers/promises'

import fg from 'fast-glob'

import { collectAssets } from './assets'
import { CompilerProcessError, readConfig } from './compiler'
import { hash, inside, slash } from './files'

import type { TscOptions } from './options'
import type { ExecutorContext, ExecutorResult } from '@isox-sh/core'

/** Content snapshots catch atomic saves, additions/deletions, and config changes. */
export async function snapshot(tsConfig: string, options: TscOptions, context: ExecutorContext, signal: AbortSignal): Promise<string> {
  const parsed = await readConfig(tsConfig, context.workspaceRoot, signal)
  const roots = [parsed.config?.compilerOptions.outDir, parsed.config?.compilerOptions.declarationDir]
    .filter((value): value is string => !!value).map(value => resolve(dirname(tsConfig), value))
  const files = new Set(await fg('**/*', {
    cwd: context.workspaceRoot,
    absolute: true,
    dot: true,
    followSymbolicLinks: false,
    ignore: [
      '**/node_modules/**',
      '**/.git/**',
      '**/.isox/**',
      '**/dist/**',
      '**/build/**',
      '**/coverage/**',
      '**/.cache/**',
      '**/*.tsbuildinfo',
    ],
  }))
  for (const file of parsed.config?.files ?? []) {
    files.add(resolve(dirname(tsConfig), file))
  }
  files.add(tsConfig)
  const parts = [parsed.output]
  for (const file of [...files].sort()) {
    if (roots.some(root => inside(root, file))) {
      continue
    }

    try {
      parts.push(`${slash(file)}:${hash(await readFile(file))}`)
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
        throw error
      }
      parts.push(`${slash(file)}:missing`)
    }
  }

  if (roots.length && options.assets?.length) {
    try {
      for (const [file, data] of await collectAssets(options, context, roots[0], roots)) {
        parts.push(`${file}:${hash(data)}`)
      }
    } catch (error) {
      parts.push(String(error))
    }
  }

  return hash(parts.join('\n'))
}

export function watchBuilds(
  tsConfig: string,
  options: TscOptions,
  context: ExecutorContext,
  build: (signal: AbortSignal) => Promise<ExecutorResult>,
): AsyncIterable<ExecutorResult> {
  return {
    [Symbol.asyncIterator]() {
      const controller = new AbortController()
      const signal = context.signal ? AbortSignal.any([controller.signal, context.signal]) : controller.signal
      const stop = () => controller.abort()
      const generator = (async function*() {
        process.once('SIGINT', stop)
        process.once('SIGTERM', stop)
        try {
          let fingerprint = await snapshot(tsConfig, options, context, signal)
          while (!signal.aborted) {
            let result: ExecutorResult
            try {
              result = await build(signal)
            } catch (error) {
              if (signal.aborted) {
                break
              }

              if (error instanceof CompilerProcessError) {
                throw error
              }
              context.logger.error(error instanceof Error ? error.message : String(error))
              result = { success: false }
            }

            if (signal.aborted) {
              break
            }
            yield { success: result.success, continuous: true }
            while (!signal.aborted) {
              try {
                await delay(options.pollInterval ?? 500, undefined, { signal })
              } catch {
                break
              }

              if (signal.aborted) {
                break
              }

              const next = await snapshot(tsConfig, options, context, signal)
              if (next !== fingerprint) {
                fingerprint = next
                break
              }
            }
          }
        } finally {
          stop()
          process.removeListener('SIGINT', stop)
          process.removeListener('SIGTERM', stop)
        }
      })()
      return {
        next: () => generator.next(),
        return: async () => {
          stop()
          return generator.return()
        },
        throw: async (error: unknown) => {
          stop()
          return generator.throw(error)
        },
      }
    },
  }
}
