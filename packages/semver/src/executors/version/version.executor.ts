import { open, realpath, rm, writeFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'

import { writeJson } from '@isox-sh/core'

import { prependChangelog } from '../../helpers/commits'
import { gitClient } from '../../helpers/git'
import { preparePostTargets, runPostTargets } from '../../helpers/post-targets'
import { validateOptions } from './options'
import { planRelease } from './plan'

import type { VersionOptions } from './options'
import type { ExecutorContext, ExecutorResult } from '@isox-sh/core'

export type { VersionOptions, PostTarget } from './options'

async function release(options: VersionOptions, context: ExecutorContext): Promise<ExecutorResult> {
  const plan = await planRelease(options, context)
  const { git, values } = plan

  if (!values) {
    context.logger.info(`No releasable commits for ${context.projectName}.`)

    return { success: true }
  }

  const targets = preparePostTargets(options.postTargets ?? [], context, values)

  context.logger.info(`${context.projectName}: ${plan.currentVersion} → ${values.version} (${values.tag})`)

  if (options.dryRun) {
    context.logger.info(values.notes)
    context.logger.info(`Dry run: would ${options.skipCommit ? 'stage files and tag existing HEAD' : 'commit files and tag the release commit'} (${plan.projects.length} package(s), ${plan.changelogs.length} changelog(s))${options.push ? ', push' : ''}, and run ${targets.length} post target(s).`)

    return { success: true }
  }

  if (await git(['status', '--porcelain', '--untracked-files=all'])) {
    throw new Error('Release requires a clean working tree and index. Commit or stash changes first.')
  }

  // Detached checkouts can create local tags; pushing must identify a real branch.
  const branch = options.push ? await git(['symbolic-ref', '--quiet', 'HEAD']) : undefined
  const remote = options.remote ?? 'origin'

  if (options.push) {
    await git(['remote', 'get-url', '--', remote])
  }

  // Planning reads history and configuration before any write. Detect a concurrent checkout/commit.
  if (await git(['rev-parse', 'HEAD']) !== plan.head) {
    throw new Error('Git HEAD changed during release planning. Try again.')
  }

  context.signal?.throwIfAborted()
  const files: string[] = []

  for (const project of plan.projects) {
    await writeJson('package.json', {
      ...project.manifest,
      version: values.version
    }, {
      projectRoot: project.root,
      workspaceRoot: context.workspaceRoot,
      logger: context.logger
    })
    files.push(`${project.path}/package.json`)
  }

  for (const changelog of plan.changelogs) {
    await writeFile(join(changelog.root, 'CHANGELOG.md'), prependChangelog(changelog.previous, changelog.notes))
    context.logger.info(`Updated file ${join(changelog.path, 'CHANGELOG.md')}`)
    files.push(`${changelog.path}/CHANGELOG.md`)
  }

  await git(['add', '--', ...files])

  if (!options.skipCommit) {
    // An explicit first release may only create a tag when changelogs are disabled.
    await git(['commit', '--allow-empty', '-m', plan.commitMessage!])
  }

  const commit = await git(['rev-parse', 'HEAD'])

  await git(['tag', '-a', '-m', `Release ${values.tag}`, '--', values.tag, commit])

  try {
    if (options.push && branch) {
      // Push only this branch and release tag, together; never push unrelated local tags.
      await git(['push', '--atomic', '--', remote, `${commit}:${branch}`, `refs/tags/${values.tag}:refs/tags/${values.tag}`])
    }

    await runPostTargets(targets, context)
  } catch (error) {
    throw new Error(`Release ${values.tag} was ${options.skipCommit ? 'staged and tagged at existing HEAD' : 'committed and tagged'}, but push or a post target failed. Keep the release and retry the failed step: ${(error as Error).message}`, { cause: error })
  }

  return { success: true }
}

export default async function version(options: VersionOptions, context: ExecutorContext): Promise<ExecutorResult> {
  validateOptions(options)
  context.signal?.throwIfAborted()

  if (options.dryRun) {
    return release(options, context)
  }

  const git = gitClient(context.workspaceRoot, context.signal)
  const directory = await realpath(resolve(context.workspaceRoot, await git(['rev-parse', '--git-common-dir'])))
  const lockPath = join(directory, 'isox-release.lock')
  let lock

  try {
    lock = await open(lockPath, 'wx')
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'EEXIST') {
      throw new Error(`Another release is using this repository. Run release targets with --parallel=1. If the process was killed, remove ${lockPath} after confirming no release is active.`, { cause: error })
    }

    throw error
  }

  try {
    await lock.writeFile(`${process.pid}\n`)

    return await release(options, context)
  } finally {
    await lock.close()
    await rm(lockPath, { force: true })
  }
}
