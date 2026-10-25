import { realpath } from 'node:fs/promises'

import { gt, lt, prerelease, rcompare, valid, validRange } from 'semver'

import { parseCommits, recommendedBump, releaseNotes } from '../../helpers/commits'
import { readReleaseFile } from '../../helpers/files'
import { gitClient } from '../../helpers/git'
import { releaseProjects, repositoryPath } from './projects'
import { nextVersion } from './version'

import type { GitClient } from '../../helpers/git'
import type { ReleaseValues } from '../../helpers/post-targets'
import type { VersionOptions } from './options'
import type { ReleaseProject } from './projects'
import type { ExecutorContext } from '@isox-sh/core'

interface ReleaseChangelog {
  root: string
  path: string
  previous: string
  notes: string
}

export interface ReleasePlan {
  git: GitClient
  head: string
  currentVersion: string
  projects: ReleaseProject[]
  changelogs: ReleaseChangelog[]
  commitMessage?: string
  values?: ReleaseValues
}

export async function planRelease(options: VersionOptions, context: ExecutorContext): Promise<ReleasePlan> {
  const locate = gitClient(context.workspaceRoot, context.signal)
  const repositoryRoot = await realpath(await locate(['rev-parse', '--show-toplevel']))
  const workspaceRoot = await realpath(context.workspaceRoot)
  const git = gitClient(repositoryRoot, context.signal)

  if (await git(['rev-parse', '--is-shallow-repository']) === 'true') {
    throw new Error('Releases require full Git history and tags. Fetch them before releasing (checkout fetch-depth: 0 in CI).')
  }

  const head = await git(['rev-parse', '--verify', 'HEAD'])
  const projects = await releaseProjects(context, repositoryRoot, options.syncVersions ?? false)
  const prefix = (options.tagPrefix ?? (options.syncVersions ? 'v' : '{projectName}@')).replaceAll('{projectName}', context.projectName)
  const allTags = (await git(['tag', '--list'])).split('\n')
  const tags = (await git(['tag', '--merged', head])).split('\n')
    .filter(tag => tag.startsWith(prefix) && valid(tag.slice(prefix.length)) === tag.slice(prefix.length))
    .sort((a, b) => rcompare(a.slice(prefix.length), b.slice(prefix.length)))
  const previousTag = tags[0]
  // The first synchronized release starts at the highest package version, avoiding downgrades.
  const currentVersion = previousTag?.slice(prefix.length) ?? projects.map(project => project.manifest.version).sort(rcompare)[0]

  for (const project of projects) {
    // Tag-only releases leave source manifests behind; never accept a manifest ahead of the tag.
    if (previousTag && currentVersion !== project.manifest.version && (!options.skipCommit || gt(project.manifest.version, currentVersion))) {
      throw new Error(`Package version ${project.manifest.version} in ${project.path} differs from latest reachable release ${previousTag}. Restore the released version before releasing.`)
    }
  }

  const commitsFor = async (path: string) => parseCommits(await git([
    'log', '--no-merges', '--format=%H%x00%B%x00', previousTag ? `refs/tags/${previousTag}..${head}` : head,
    '--', path
  ]))
  const historyPath = options.syncVersions ? repositoryPath(repositoryRoot, workspaceRoot) : projects[0].path
  const commits = await commitsFor(historyPath)
  const bump = options.releaseAs ?? await recommendedBump(commits)
  const plan: ReleasePlan = {
    git,
    head,
    currentVersion,
    projects,
    changelogs: []
  }

  if (!bump) {
    return plan
  }

  const version = nextVersion(currentVersion, bump, options.preid)

  if (!version || (version !== bump && !['major', 'minor', 'patch'].includes(bump))) {
    throw new Error('releaseAs must be major, minor, patch, or an exact semantic version.')
  }

  if (lt(version, currentVersion) || (previousTag && !gt(version, currentVersion))) {
    throw new Error(`Release version ${version} must be newer than ${currentVersion}.`)
  }

  const tag = `${prefix}${version}`

  if (tag.startsWith('-')) {
    throw new Error('Release tags must not start with a dash.')
  }

  await git(['check-ref-format', `refs/tags/${tag}`])

  if (allTags.includes(tag)) {
    throw new Error(`Release tag already exists: ${tag}`)
  }

  const date = new Date()
  const notes = await releaseNotes(version, commits, date)
  const changelogRoots = new Set([
    ...(options.syncVersions ? [workspaceRoot] : []),
    ...(!options.skipProjectChangelog ? projects.map(project => project.root) : [])
  ])

  for (const root of changelogRoots) {
    const path = repositoryPath(repositoryRoot, root)

    plan.changelogs.push({
      root,
      path,
      previous: await readReleaseFile(root, 'CHANGELOG.md', true),
      notes: path === historyPath ? notes : await releaseNotes(version, await commitsFor(path), date)
    })
  }

  plan.commitMessage = (options.commitMessageFormat ?? 'chore({projectName}): Release {version}')
    .replace(/\{(projectName|version)\}/g, (_, name: string) => name === 'version' ? version : context.projectName)
  // Derive publication metadata from the final version, including exact releaseAs overrides.
  const identifiers = prerelease(version) ?? []
  const preid = (identifiers.length > 1 && typeof identifiers.at(-1) === 'number'
    ? identifiers.slice(0, -1) : identifiers).join('.')
  // npm rejects version-like dist-tags; a prerelease must not default to latest.
  const npmTag = preid ? (validRange(preid) || preid === 'latest' ? 'next' : preid) : 'latest'

  plan.values = {
    projectName: context.projectName,
    version,
    tag,
    previousTag: previousTag ?? '',
    preid,
    npmTag,
    prerelease: identifiers.length > 0,
    notes,
    dryRun: options.dryRun ?? false
  }

  return plan
}
