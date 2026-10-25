import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'

import { runProcess } from '@isox-sh/core'

import { optionsValidator } from '../../helpers/validation'

import type { ExecutorContext, ExecutorResult } from '@isox-sh/core'

export interface GithubOptions {
  tag: string
  notes: string
  title?: string
  repository?: string
  draft?: boolean
  prerelease?: boolean
  dryRun?: boolean
}

const validateOptions: (options: unknown) => asserts options is GithubOptions = optionsValidator(
  resolve(__dirname, 'github.schema.json'), 'semver:github'
)

export default async function github(options: GithubOptions, context: ExecutorContext): Promise<ExecutorResult> {
  validateOptions(options)
  context.signal?.throwIfAborted()

  if (options.dryRun) {
    context.logger.info(`Would create GitHub release ${options.tag}.`)

    return { success: true }
  }

  const directory = await mkdtemp(join(tmpdir(), 'isox-release-'))

  try {
    const notes = join(directory, 'notes.md')

    await writeFile(notes, options.notes)
    const args = ['release', 'create', '--verify-tag', `--title=${options.title ?? options.tag}`, `--notes-file=${notes}`]

    if (options.repository) {
      args.push(`--repo=${options.repository}`)
    }

    if (options.draft) {
      args.push('--draft')
    }

    if (options.prerelease) {
      args.push('--prerelease')
    }

    args.push('--', options.tag)

    return await runProcess('gh', args, {
      cwd: context.workspaceRoot,
      signal: context.signal
    })
  } finally {
    await rm(directory, {
      recursive: true,
      force: true
    })
  }
}
