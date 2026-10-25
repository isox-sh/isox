import { resolve } from 'node:path'

import { valid } from 'semver'

import { optionsValidator } from '../../helpers/validation'

export interface PostTarget {
  /** A local target, project:target, or project:target:configuration. */
  target: string
  options?: Record<string, unknown>
}

export interface VersionOptions {
  dryRun?: boolean
  skipCommit?: boolean
  syncVersions?: boolean
  skipProjectChangelog?: boolean
  commitMessageFormat?: string
  releaseAs?: string
  preid?: string
  tagPrefix?: string
  push?: boolean
  remote?: string
  postTargets?: (string | PostTarget)[]
}

const validateSchema: (options: unknown) => asserts options is VersionOptions = optionsValidator(
  resolve(__dirname, 'version.schema.json'), 'semver:version'
)

export function validateOptions(options: unknown): asserts options is VersionOptions {
  validateSchema(options)

  if (options.preid !== undefined && !valid(`0.0.0-${options.preid}.0`)) {
    throw new Error('Invalid semver:version options: preid must be a valid semantic version prerelease identifier.')
  }
}
