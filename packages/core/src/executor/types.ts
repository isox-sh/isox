import type { Logger } from '../logger'
import type { ExecutorConfiguration, ProjectConfiguration, WorkspaceGraph } from '../workspace/parser'

export interface ExecutorContext {
  workspaceRoot: string
  projectRoot: string
  projectName: string
  commandName: string
  configurationName?: string
  project: ProjectConfiguration
  command: ExecutorConfiguration
  workspace: WorkspaceGraph
  logger: Logger
  verbose: boolean
  /** Cooperative cancellation for long-running native commands. */
  signal?: AbortSignal
}

export interface ExecutorResult {
  success: boolean
  /** A rebuild result from a continuing command; failure is recoverable. */
  continuous?: boolean
}

export type ExecutorOutput = ExecutorResult | AsyncIterable<ExecutorResult>

export type Executor<Options = Record<string, unknown>> = (
  options: Options,
  context: ExecutorContext,
) => ExecutorOutput | Promise<ExecutorOutput>
