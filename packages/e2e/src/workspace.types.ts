import type { Logger } from '@isox-sh/core'

export interface CreateWorkspaceOptions {
  /** Find the owning isox.json from here. Defaults to process.cwd(). */
  startDirectory?: string
  /** Package names mapped to built package directories, relative to the owning workspace or absolute. */
  plugins?: Record<string, string>
  /** Use a different CLI package directory, relative to the owning workspace or absolute. */
  cliDirectory?: string
  /** Timeout for each child process, in milliseconds. Defaults to 30 seconds. */
  timeout?: number
  logger?: Logger
}

export interface CommandOutput {
  stdout: string
  stderr: string
}

export interface TestWorkspace {
  /** Fixture root, under the owning workspace's tmp directory. */
  root: string
  /** Version of the CLI used by runIsox. */
  version: string
  /** Invoke the CLI with argument strings. A nonzero exit rejects with stdout and stderr. */
  runIsox(args: string[], cwd?: string): Promise<CommandOutput>
  runNode(args: string[], cwd?: string): Promise<CommandOutput>
  /** Remove this fixture only. Safe to call more than once. */
  cleanup(): Promise<void>
}
