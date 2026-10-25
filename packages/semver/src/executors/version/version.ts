import { inc, prerelease, valid } from 'semver'

export function nextVersion(current: string, bump: string, preid?: string): string | null {
  if (bump !== 'major' && bump !== 'minor' && bump !== 'patch') {
    return valid(bump)
  }

  const stable = inc(current, bump)

  if (!preid || !stable) {
    return stable
  }

  // A prerelease already covers changes up to its eventual stable version.
  if (prerelease(current) && inc(current, 'patch') === stable) {
    return inc(current, 'prerelease', preid)
  }

  return valid(`${stable}-${preid}.0`)
}
