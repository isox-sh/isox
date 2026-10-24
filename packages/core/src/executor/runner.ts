import { dirname, resolve } from 'node:path'

import { logger, LogLevels } from '../logger'
import { readWorkspaceSettings } from '../workspace/settings'
import { resolveCommandOptions } from './configuration'
import { runNxExecutor } from './nx'

import type { Logger } from '../logger'
import type { WorkspaceGraph } from '../workspace/parser'
import type { ExecutorContext, ExecutorResult } from './types'

export async function runExecutor(
  workspace: WorkspaceGraph,
  projectName: string,
  commandName: string,
  workspaceRoot: string,
  taskLogger: Logger = logger,
  requestedConfiguration?: string,
): Promise<void> {
  const project = Object.hasOwn(workspace.projects, projectName) ? workspace.projects[projectName] : undefined
  if (!project) {
    throw new Error(`Project ${projectName} not found in workspace.`)
  }
  const command = Object.hasOwn(project.commands ?? {}, commandName) ? project.commands?.[commandName] : undefined
  if (!command) {
    throw new Error(`Command ${commandName} not found in project ${projectName}.`)
  }
  const { options, configurationName } = resolveCommandOptions(command, projectName, commandName, requestedConfiguration)
  const executorName = command.executor
  if (typeof executorName !== 'string' || !/^[^\s:]+:[^\s:]+$/.test(executorName)) {
    throw new Error('Invalid executor format. Use package:executor.')
  }
  const [pkg, executorConfigName] = executorName.split(':')
  const root = resolve(workspaceRoot)
  const settings = await readWorkspaceSettings(root)
  const isNxExecutor = (settings.nx?.executors ?? []).some(entry =>
    entry === pkg || (entry.startsWith('@') && !entry.includes('/') && pkg.startsWith(`${entry}/`)),
  )
  const pkgJsonPath = require.resolve(`${pkg}/package.json`, { paths: [root] })
  const pkgJson = require(pkgJsonPath)
  const manifest = isNxExecutor ? pkgJson.executors ?? pkgJson.builders : pkgJson.commands
  if (typeof manifest !== 'string') {
    throw new Error(`Package ${pkg} does not define ${isNxExecutor ? 'an executors or builders' : 'a commands'} manifest.`)
  }

  const manifestPath = resolve(dirname(pkgJsonPath), manifest)
  const manifestJson = require(manifestPath)
  const registry = isNxExecutor ? manifestJson.executors ?? manifestJson.builders : manifestJson.commands
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
  }

  const assertSuccess = (output: ExecutorResult): void => {
    if (output?.success !== true) {
      throw new Error(`Task failed for ${projectName}`)
    }
  }

  taskLogger.info(`Running ${executorName} for ${projectName}...`)
  const result = isNxExecutor
    ? await runNxExecutor(executorFn, options, context, pkgJsonPath)
    : await executorFn(options, context)
  if (result && typeof result[Symbol.asyncIterator] === 'function') {
    let hasResult = false
    for await (const output of result) {
      hasResult = true
      assertSuccess(output)
    }
    if (!hasResult) {
      throw new Error(`Task failed for ${projectName}: executor returned no results.`)
    }
  } else {
    assertSuccess(result)
  }
  taskLogger.success(`Successfully completed ${executorName} for ${projectName}.`)
}
