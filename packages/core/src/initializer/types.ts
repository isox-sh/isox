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

/** The `init` generator in generators.json creates a project within an existing workspace. */
export type ProjectInitializer = (options: InitializerOptions, context: InitializerContext) => Promise<void>

/** The `add` generator in generators.json configures an existing project without scaffolding a new one. */
export type ProjectAdder = (options: Record<string, unknown>, context: InitializerContext) => Promise<void>
