import type { Logger } from '../logger'
import type { CommandConfiguration, ProjectConfiguration, WorkspaceGraph } from '../workspace/parser'

export interface ExecutorContext {
  workspaceRoot: string
  projectRoot: string
  projectName: string
  commandName: string
  configurationName?: string
  project: ProjectConfiguration
  command: CommandConfiguration
  workspace: WorkspaceGraph
  logger: Logger
  verbose: boolean
}

export interface ExecutorResult {
  success: boolean
}

export type ExecutorOutput = ExecutorResult | AsyncIterable<ExecutorResult>

export type Executor<Options = Record<string, unknown>> = (
  options: Options,
  context: ExecutorContext,
) => ExecutorOutput | Promise<ExecutorOutput>
