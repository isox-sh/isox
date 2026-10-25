import { execFileSync } from 'node:child_process'

function git(context, args) {
  try {
    return execFileSync('git', args, {
      cwd: context.cwd,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    }).trim()
  } catch (error) {
    const detail = error.stderr?.toString().trim() || error.message
    throw new Error(`Git ${args[0]} failed: ${detail}. Check the ref and fetch full history and tags (actions/checkout fetch-depth: 0).`, { cause: error })
  }
}

export function resolveRevision(context, ref) {
  return git(context, ['rev-parse', '--verify', '--end-of-options', `${ref}^{commit}`])
}

/** Git does not attach tags to branches: only tags reachable from this head qualify. */
export function latestBranchTag(context, head) {
  if (git(context, ['rev-parse', '--is-shallow-repository']) === 'true') {
    throw new Error('Tag selection requires full Git history and tags. Use actions/checkout with fetch-depth: 0.')
  }

  const tags = git(context, ['for-each-ref', `--merged=${head}`, '--format=%(refname)', 'refs/tags'])
  if (!tags) {
    return undefined
  }

  // Include lightweight tags and consider every reachable candidate, not just Git's default ten.
  return git(context, ['describe', '--tags', '--abbrev=0', `--candidates=${tags.split('\n').length}`, head])
}

export function resolvePlanRange(context, options) {
  const checkedOutHead = resolveRevision(context, 'HEAD')
  if (options.affectedOnly === false) {
    return { head: checkedOutHead }
  }

  const head = resolveRevision(context, options.head || options.sha || 'HEAD')
  if (head !== checkedOutHead) {
    throw new Error('Check out the requested head before planning so project definitions match the compared commit.')
  }

  let base = options.base
  if (!base && options.eventName === 'pull_request') {
    base = options.event?.pull_request?.base?.sha
    if (!base) {
      throw new Error('The pull request event is missing its base SHA. Provide the base input explicitly.')
    }
  }
  if (!base) {
    base = latestBranchTag(context, head)
  }

  return { head, base: base ? resolveRevision(context, base) : undefined }
}
