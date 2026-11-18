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

export interface ExecutorPlannerContext {
  workspaceRoot: string
  projectRoot: string
  projectName: string
  commandName: string
  configurationName?: string
  plannerOptions: Record<string, unknown>
  maxJobs: number
}

/** Return one main-target option override object per job within the assigned budget. */
export interface ExecutorPlanner<Options = Record<string, unknown>> {
  (options: Options, context: ExecutorPlannerContext): Record<string, unknown>[] | Promise<Record<string, unknown>[]>
  /** Reserve an exact number of jobs before automatic job allocation. */
  requestedJobs?: (options: Options, plannerOptions: Record<string, unknown>) => number | undefined
}
