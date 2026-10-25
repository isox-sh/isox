import { execFile } from 'node:child_process'
import { realpath } from 'node:fs/promises'
import { isAbsolute, relative, resolve, sep } from 'node:path'
import { promisify } from 'node:util'

interface GitFailureDetails {
  stderr?: string
}

const exec = promisify(execFile)

export interface GitChangesOptions {
  base?: string
  head?: string
  uncommitted?: boolean
  untracked?: boolean
}

export interface GitChanges {
  base: string
  head: string
  mergeBase: string
  files: string[]
}

/** Revisions are arguments, and paths are NUL-delimited to preserve unusual filenames. */
export async function getGitChanges(workspaceRoot: string, options: GitChangesOptions = {}): Promise<GitChanges> {
  // Git reports physical paths; callers may reach the same workspace through a symlink.
  workspaceRoot = await realpath(workspaceRoot)
  const git = async (args: string[], cwd = workspaceRoot): Promise<string> => {
    try {
      const result = await exec('git', args, {
        cwd,
        encoding: 'utf8',
        maxBuffer: 64 * 1024 * 1024
      })

      return result.stdout
    } catch (error) {
      const detail = error as Error & GitFailureDetails

      throw new Error(`Git ${args[0]} failed: ${detail.stderr?.trim() || detail.message}. Check the base/head refs and fetch full history (actions/checkout fetch-depth: 0).`, { cause: error })
    }
  }

  const revision = async (value: string): Promise<string> => {
    if (!value || value.includes('\0')) {
      throw new Error('Git base/head must be non-empty revisions.')
    }

    return (await git(['rev-parse', '--verify', '--end-of-options', `${value}^{commit}`])).trim()
  }

  const [repository, base, head] = await Promise.all([
    git(['rev-parse', '--show-toplevel']),
    revision(options.base ?? process.env.ISOX_BASE ?? 'origin/main'),
    revision(options.head ?? process.env.ISOX_HEAD ?? 'HEAD'),
  ])
  const repositoryRoot = repository.replace(/\r?\n$/, '')
  const mergeBase = (await git(['merge-base', base, head])).trim()
  const args = ['--name-only', '--no-renames', '--no-ext-diff', '-z']
  const changes = await Promise.all([
    git(['diff', ...args, mergeBase, head, '--'], repositoryRoot),
    options.uncommitted ? git(['diff', ...args, '--cached', '--'], repositoryRoot) : '',
    options.uncommitted ? git(['diff', ...args, '--'], repositoryRoot) : '',
    options.untracked ? git(['ls-files', '--others', '--exclude-standard', '-z'], repositoryRoot) : '',
  ])

  const files = new Set<string>()

  for (const file of changes.flatMap(output => output.split('\0').filter(Boolean))) {
    const workspaceFile = relative(workspaceRoot, resolve(repositoryRoot, file))

    // An Isox workspace may occupy just one directory in a larger Git repository.
    if (workspaceFile === '..' || workspaceFile.startsWith(`..${sep}`) || isAbsolute(workspaceFile)) {
      continue
    }

    files.add(workspaceFile.split(sep).join('/'))
  }

  return {
    base,
    head,
    mergeBase,
    files: [...files].sort()
  }
}
