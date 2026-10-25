import type { Logger } from '../logger'

export interface InitializerOptions {
  importPath?: string
}

export interface InitializerContext {
  workspaceRoot: string
  projectRoot: string
  projectName: string
  logger: Logger
}

/** A package's `init` entry creates a project within an existing workspace. */
export type ProjectInitializer = (options: InitializerOptions, context: InitializerContext) => Promise<void>
