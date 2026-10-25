import type { Options as WriterOptions } from 'conventional-changelog-writer'
import type { Commit, ParserOptions } from 'conventional-commits-parser'

export type Bump = 'major' | 'minor' | 'patch'

interface BumpRecommendation {
  level: 0 | 1 | 2
}

// The preset's published declaration returns {}, so describe the parts we consume.
interface ConventionalPreset {
  parser: ParserOptions
  writer: WriterOptions<Commit>
  whatBump(commits: Commit[]): BumpRecommendation | null
}

const preset = import('conventional-changelog-conventionalcommits')
  .then(({ default: createPreset }) => createPreset() as ConventionalPreset)

/** Git emits NUL-separated hash/message pairs; commit bodies may contain arbitrary newlines. */
export async function parseCommits(log: string): Promise<Commit[]> {
  const { CommitParser } = await import('conventional-commits-parser')
  const { filterRevertedCommitsSync } = await import('conventional-commits-filter')
  const parser = new CommitParser((await preset).parser)
  const fields = log.split('\0')
  const commits: Commit[] = []

  for (let index = 0; index + 1 < fields.length; index += 2) {
    const commit = parser.parse(fields[index + 1].trim())

    commit.hash = fields[index].trim()
    // Git's default revert message has no conventional header.
    commit.type = commit.type?.toLowerCase() || (commit.revert ? 'revert' : null)
    commits.push(commit)
  }

  // Use the same effective commits for bump selection and changelog generation.
  return [...filterRevertedCommitsSync(commits)]
}

export async function recommendedBump(commits: Commit[]): Promise<Bump | undefined> {
  const recommendation = (await preset).whatBump(commits)
  const bumps: Bump[] = ['major', 'minor', 'patch']

  return recommendation ? bumps[recommendation.level] : undefined
}

export async function releaseNotes(version: string, commits: Commit[], date = new Date()): Promise<string> {
  const { writeChangelogString } = await import('conventional-changelog-writer')

  return writeChangelogString(commits, {
    version,
    date: date.toISOString().slice(0, 10),
    linkCompare: false,
    linkReferences: false
  }, {
    ...(await preset).writer,
    ignoreReverted: false
  })
}

export function prependChangelog(previous: string, notes: string): string {
  const heading = /^# Changelog\s*\n/i
  const body = previous.replace(heading, '').trim()

  return `# Changelog\n\n${notes.trim()}\n${body ? `\n${body}\n` : ''}`
}
