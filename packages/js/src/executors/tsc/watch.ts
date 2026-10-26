import { readFile } from 'node:fs/promises'
import { relative, resolve } from 'node:path'
import { setTimeout as delay } from 'node:timers/promises'

import fg from 'fast-glob'
import ts from 'typescript'

import { collectAssets } from './assets'
import { buildConfiguration } from './build-config'
import { CompilerProcessError } from './compiler'
import { hash, inside, slash } from './files'
import { watchSources } from './watch-sources'

import type { TscOptions } from './options'
import type { SourceGraph } from './watch-sources'
import type { ExecutorContext, ExecutorResult } from '@isox-sh/core'

interface SnapshotConfiguration {
  inputs: Map<string, string | undefined>
  roots: string[]
  sources: string[]
  directories: string[]
  outputs: string[]
  diagnostics: string[]
  options: ts.CompilerOptions
}

interface SnapshotState {
  sourceGraph?: SourceGraph
  configuration?: SnapshotConfiguration
}

async function configuration(tsConfig: string, context: ExecutorContext, state: SnapshotState) {
  const cached = state.configuration

  if (cached && !cached.diagnostics.length && [...cached.inputs].every(([file, source]) => ts.sys.readFile(file) === source)) {
    return cached
  }

  const inputs = new Map<string, string | undefined>()
  const readConfigFile = (file: string) => {
    const source = ts.sys.readFile(file)

    inputs.set(file, source)

    return source
  }

  const diagnostics: string[] = []
  // Resolve configs only when their contents change, tracking extended configs and
  // dependency configs too. No native compiler process is needed for polling.
  const parsed = ts.getParsedCommandLineOfConfigFile(tsConfig, {}, {
    ...ts.sys,
    readFile: readConfigFile,
    onUnRecoverableConfigFileDiagnostic: error => diagnostics.push(ts.flattenDiagnosticMessageText(error.messageText, '\n')),
  })

  for (const error of parsed?.errors ?? []) {
    diagnostics.push(ts.flattenDiagnosticMessageText(error.messageText, '\n'))
  }

  let outputs: string[] = []
  let options = parsed?.options ?? {}

  try {
    const build = await buildConfiguration(tsConfig, context, readConfigFile)

    outputs = build?.outputs ?? []

    if (build) {
      options = {
        ...options,
        paths: build.config.compilerOptions.paths
      }
    }
  } catch (error) {
    diagnostics.push(String(error))
  }

  state.configuration = {
    inputs,
    roots: parsed?.options.noEmit ? [] : [parsed?.options.outDir, parsed?.options.declarationDir]
      .filter((value): value is string => !!value),
    sources: parsed?.fileNames ?? [],
    directories: Object.keys(parsed?.wildcardDirectories ?? {}),
    outputs,
    diagnostics,
    options,
  }

  return state.configuration
}

/** Content snapshots catch atomic saves, additions/deletions, and config changes. */
export async function snapshot(
  tsConfig: string,
  options: TscOptions,
  context: ExecutorContext,
  signal: AbortSignal,
  state: SnapshotState = {},
): Promise<string> {
  signal.throwIfAborted()
  const plan = await configuration(tsConfig, context, state)
  const { roots } = plan
  const files = new Set([...plan.inputs.keys(), ...plan.sources, resolve(context.workspaceRoot, 'package.json')])
  const parts = [...plan.diagnostics]
  // Project metadata and schemas affect packaging. Wildcard directories also
  // capture new compiler inputs outside the project without scanning unrelated trees.
  const directories = new Set([context.projectRoot, ...plan.directories, ...plan.outputs])

  for (const directory of directories) {
    for (const file of await fg('**/*', {
      cwd: directory,
      absolute: true,
      dot: true,
      followSymbolicLinks: false,
      ignore: [
        '**/node_modules/**', '**/.git/**', '**/.isox/**',
        '**/dist/**', '**/build/**', '**/coverage/**', '**/.cache/**', '**/*.tsbuildinfo',
        ...roots.filter(root => inside(directory, root))
          .map(root => `${fg.escapePath(slash(relative(directory, root)))}/**`),
      ],
    })) {
      files.add(file)
    }
  }

  for (const project of Object.values(context.workspace?.projects ?? {})) {
    files.add(resolve(context.workspaceRoot, project.root, 'package.json'))
  }

  const sourceRoots = [...files].filter(file => /\.[cm]?[jt]sx?$/.test(file)
    && !roots.some(root => inside(root, file))).sort()

  state.sourceGraph = watchSources(sourceRoots, plan.options, state.sourceGraph)
  for (const file of [...state.sourceGraph.sources, ...state.sourceGraph.contents.keys()]) {
    files.add(file)
  }

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
          const state: SnapshotState = {}
          let fingerprint = await snapshot(tsConfig, options, context, signal, state)

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

            // A rebuild may have introduced imports of another workspace project.
            // Refresh watched dependency outputs once, rather than on every poll.
            state.configuration = undefined

            yield {
              success: result.success,
              continuous: true
            }
            while (!signal.aborted) {
              try {
                await delay(options.pollInterval ?? 500, undefined, { signal })
              } catch {
                break
              }

              if (signal.aborted) {
                break
              }

              const next = await snapshot(tsConfig, options, context, signal, state)

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
