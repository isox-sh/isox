import { execFile } from 'node:child_process'
import { promisify } from 'node:util'

const execute = promisify(execFile)

/** All Git arguments stay separate from the shell, including paths and commit messages. */
export function gitClient(cwd: string, signal?: AbortSignal) {
  return async (args: string[]): Promise<string> => {
    signal?.throwIfAborted()

    try {
      const result = await execute('git', args, {
        cwd,
        signal,
        encoding: 'utf8',
        maxBuffer: 32 * 1024 * 1024,
        env: {
          ...process.env,
          GIT_LITERAL_PATHSPECS: '1'
        }
      })

      return result.stdout.replace(/\r?\n$/, '')
    } catch (error) {
      signal?.throwIfAborted()
      throw new Error(`git ${args[0]} failed: ${(error as Error).message}`, { cause: error })
    }
  }
}

export type GitClient = ReturnType<typeof gitClient>
