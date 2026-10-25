import { dirname, resolve } from 'node:path'

import { logger, LogLevels } from '../logger'
import { readWorkspaceSettings } from '../workspace/settings'
import { resolveCommandOptions } from './configuration'

import type { Logger } from '../logger'
import type { WorkspaceGraph } from '../workspace/parser'
import type { Executor, ExecutorContext, ExecutorOutput, ExecutorResult } from './types'

export async function runExecutor(
  workspace: WorkspaceGraph,
  projectName: string,
  commandName: string,
  workspaceRoot: string,
  taskLogger: Logger = logger,
  requestedConfiguration?: string,
  signal?: AbortSignal,
): Promise<void> {
  const project = Object.hasOwn(workspace.projects, projectName) ? workspace.projects[projectName] : undefined
  if (!project) {
    throw new Error(`Project ${projectName} not found in workspace.`)
  }

  const command = Object.hasOwn(project.targets ?? {}, commandName) ? project.targets?.[commandName] : undefined
  if (!command) {
    throw new Error(`Command ${commandName} not found in project ${projectName}.`)
  }

  const { options, configurationName } = resolveCommandOptions(command, projectName, commandName, requestedConfiguration)
  const executorName = command.executor
  if (typeof executorName !== 'string' || !/^[^\s:]+:[^\s:]+$/.test(executorName)) {
    throw new Error('Invalid executor format. Use package:executor.')
  }

  const [packageName] = executorName.split(':')
  const root = resolve(workspaceRoot)
  const settings = await readWorkspaceSettings(root)
  const matchesNxPackage = (pkg: string): boolean => (settings.nx?.executors ?? []).some(entry =>
    entry === pkg || (entry.startsWith('@') && !entry.includes('/') && pkg.startsWith(`${entry}/`)),
  )
  // Explicit Nx selection must resolve nx:* to nx, not the @isox-sh/nx adapter.
  const { pkg, pkgJsonPath } = resolveExecutorPackage(packageName, root, !matchesNxPackage(packageName))
  const isNxExecutor = matchesNxPackage(pkg)
  const executorFn = isNxExecutor
    ? loadNxExecutor(root, pkgJsonPath)
    : loadNativeExecutor(pkg, pkgJsonPath, executorName, taskLogger)

  const context: ExecutorContext = {
    workspaceRoot: root,
    projectRoot: resolve(root, project.root),
    verbose: taskLogger.level >= LogLevels.debug,
    projectName,
    commandName,
    configurationName,
    project,
    command,
    workspace,
    logger: taskLogger,
    signal,
  }

  const assertSuccess = (output: ExecutorResult): void => {
    if (output?.success !== true) {
      throw new Error(`Task failed for ${projectName}`)
    }
  }

  taskLogger.info(`Running ${executorName} for ${projectName}...`)
  try {
    const result = await executorFn(options, context)
    if (isAsyncIterable(result)) {
      let hasResult = false
      let continuous = false
      for await (const output of result) {
        // A stopped child may yield a failed result while the iterator is shutting down.
        if (signal?.aborted) {
          break
        }
        hasResult = true
        if (!isNxExecutor && output?.continuous === true) {
          if (typeof output.success !== 'boolean') {
            throw new Error(`Invalid continuous executor result for ${projectName}.`)
          }
          continuous = true
          if (output.success) {
            taskLogger.success(`Build completed for ${projectName}. Watching for changes...`)
          } else {
            taskLogger.error(`Build failed for ${projectName}. Watching for changes...`)
          }
        } else {
          assertSuccess(output)
        }
      }

      if (!hasResult && !signal?.aborted) {
        throw new Error(`Task failed for ${projectName}: executor returned no results.`)
      }

      if (continuous || signal?.aborted) {
        return
      }
    } else {
      if (signal?.aborted) {
        return
      }
      assertSuccess(result)
    }
  } catch (error) {
    // Abort-aware APIs reject instead of returning a result; unrelated failures still propagate.
    if (signal?.aborted && (error === signal.reason || (error instanceof Error && error.name === 'AbortError'))) {
      return
    }
    throw error
  }
  taskLogger.success(`Successfully completed ${executorName} for ${projectName}.`)
}

function isAsyncIterable(output: ExecutorOutput): output is AsyncIterable<ExecutorResult> {
  return output != null && typeof (output as AsyncIterable<ExecutorResult>)[Symbol.asyncIterator] === 'function'
}

function loadNxExecutor(root: string, pkgJsonPath: string): Executor {
  let pluginPath: string
  try {
    pluginPath = require.resolve('@isox-sh/nx', { paths: [root] })
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'MODULE_NOT_FOUND') {
      throw error
    }
    throw new Error('Nx executors require @isox-sh/nx. Install it in your workspace: npm install --save-dev @isox-sh/nx', { cause: error })
  }

  const { runNxExecutor } = require(pluginPath) as {
    runNxExecutor: (options: Record<string, unknown>, context: ExecutorContext, pluginPackagePath: string) => Promise<ExecutorOutput>
  }

  if (typeof runNxExecutor !== 'function') {
    throw new Error('Package @isox-sh/nx does not export runNxExecutor.')
  }

  return (options, context) => runNxExecutor(options, context, pkgJsonPath)
}

function loadNativeExecutor(pkg: string, pkgJsonPath: string, executorName: string, taskLogger: Logger): Executor {
  const [, executorConfigName] = executorName.split(':')
  const pkgJson = require(pkgJsonPath)
  const manifest = pkgJson.executors
  if (typeof manifest !== 'string') {
    throw new Error(`Package ${pkg} does not define an executors manifest.`)
  }

  const manifestPath = resolve(dirname(pkgJsonPath), manifest)
  const registry = require(manifestPath).executors
  const executorDef = registry && Object.hasOwn(registry, executorConfigName) ? registry[executorConfigName] : undefined
  if (!executorDef || typeof executorDef.implementation !== 'string') {
    throw new Error(`Executor ${executorConfigName} not found in ${pkg}.`)
  }

  const implPath = resolve(dirname(manifestPath), executorDef.implementation)
  taskLogger.debug(`Resolved ${executorName} to ${implPath}`)
  const executorModule = require(implPath)
  const executorFn = executorModule.default ?? executorModule
  if (typeof executorFn !== 'function') {
    throw new Error(`Executor ${executorName} does not export a function.`)
  }

  return executorFn
}

function resolveExecutorPackage(packageName: string, root: string, allowShorthand: boolean): { pkg: string, pkgJsonPath: string } {
  const candidates = allowShorthand && !packageName.startsWith('@') && !packageName.includes('/')
    ? [`@isox-sh/${packageName}`, packageName]
    : [packageName]
  let resolutionError: unknown
  for (const pkg of candidates) {
    try {
      return { pkg, pkgJsonPath: require.resolve(`${pkg}/package.json`, { paths: [root] }) }
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'MODULE_NOT_FOUND') {
        throw error
      }
      // The CLI installs core transitively, so built-ins can use this copy.
      if (pkg === '@isox-sh/core') {
        return { pkg, pkgJsonPath: resolve(__dirname, '../package.json') }
      }
      resolutionError = error
    }
  }
  throw resolutionError
}
