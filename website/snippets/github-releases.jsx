/*
 * Adapted from https://github.com/TriPSs/nestjs-query/blob/master/docs/snippets/github-releases.jsx
 *
 * MIT License
 *
 * Copyright (c) 2020 Doug Martin
 *
 * Permission is hereby granted, free of charge, to any person obtaining a copy
 * of this software and associated documentation files (the "Software"), to deal
 * in the Software without restriction, including without limitation the rights
 * to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
 * copies of the Software, and to permit persons to whom the Software is
 * furnished to do so, subject to the following conditions:
 *
 * The above copyright notice and this permission notice shall be included in all
 * copies or substantial portions of the Software.
 *
 * THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
 * IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
 * FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
 * AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
 * LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
 * OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
 * SOFTWARE.
 */

export const formatReleaseNotes = (release) => {
  const html = release.body_html || ''
  const heading = html.match(/^\s*<h([1-6])\b[^>]*>([\s\S]*?)<\/h\1>\s*/i)
  if (!heading || !release.tag_name) return html

  // Generated notes repeat the version and date already shown by Update.
  // Match a plain title or a single linked title; do not attempt to strip HTML tags.
  const link = heading[2].match(/^\s*<a\b[^>]*>([^<]*)<\/a>\s*$/i)
  const title = (link ? link[1] : heading[2])
    .trim()
    .replace(/\s+\(\d{4}-\d{2}-\d{2}\)$/, '')
    .replace(/^v/, '')
  return title === release.tag_name.replace(/^v/, '') ? html.slice(heading[0].length) : html
}

// Mintlify injects React hooks into snippets; they must not be imported from npm.
export const fetchReleases = async (page, signal) => {
  const response = await fetch(`https://api.github.com/repos/isox-sh/isox/releases?per_page=10&page=${page}`, {
    // GitHub renders and sanitizes the Markdown, preserving links, lists, and code.
    headers: { Accept: 'application/vnd.github.html+json' },
    signal
  })
  if (!response.ok) throw new Error('Unable to load releases')
  const releases = await response.json()
  if (!Array.isArray(releases)) throw new Error('Invalid releases response')
  return { releases: releases.filter((release) => !release.draft), hasMore: releases.length === 10 }
}

export const GitHubReleases = () => {
  const [releases, setReleases] = useState([])
  const [page, setPage] = useState(1)
  const [attempt, setAttempt] = useState(0)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(false)
  const [hasMore, setHasMore] = useState(false)

  useEffect(() => {
    const controller = new AbortController()
    let active = true
    setLoading(true)
    setError(false)
    fetchReleases(page, controller.signal)
      .then((result) => {
        if (!active) return
        setReleases((previous) => {
          const ids = new Set(previous.map((release) => release.id))
          return [...previous, ...result.releases.filter((release) => !ids.has(release.id))]
        })
        setHasMore(result.hasMore)
      })
      .catch(() => {
        if (active) setError(true)
      })
      .finally(() => {
        if (active) setLoading(false)
      })
    return () => {
      active = false
      controller.abort()
    }
  }, [page, attempt])

  return (
    <div className="isox-changelog" aria-busy={loading}>
      {releases.map((release) => {
        const notes = formatReleaseNotes(release)
        return (
          <Update
            key={release.id}
            label={release.tag_name}
            description={
              release.published_at
                ? new Date(release.published_at).toLocaleDateString('en-US', {
                    year: 'numeric',
                    month: 'long',
                    day: 'numeric',
                    timeZone: 'UTC'
                  })
                : undefined
            }
            tags={[release.prerelease ? 'Prerelease' : 'Stable']}
          >
            {notes ? (
              <div className="isox-changelog-notes" dangerouslySetInnerHTML={{ __html: notes }} />
            ) : (
              <p>No release notes provided.</p>
            )}
            <p>
              <a href={release.html_url}>View release on GitHub →</a>
            </p>
          </Update>
        )
      })}
      <div role="status" aria-live="polite">
        {loading && <p>Loading releases…</p>}
        {!loading && error && (
          <p>Could not load releases. GitHub may be temporarily unavailable or its request limit may have been reached.</p>
        )}
        {!loading && !error && releases.length === 0 && <p>No published releases yet.</p>}
      </div>
      {(error || hasMore || page > 1 || attempt > 0) && (
        <button
          type="button"
          className="isox-changelog-button"
          aria-disabled={loading || (!error && !hasMore)}
          onClick={() => {
            // Native disabled buttons lose focus in Chrome; keep this control focusable.
            if (loading || (!error && !hasMore)) return
            setLoading(true)
            if (error) setAttempt((value) => value + 1)
            else setPage((value) => value + 1)
          }}
        >
          {loading ? 'Loading…' : error ? 'Try again' : hasMore ? 'Load older releases' : 'All releases loaded'}
        </button>
      )}
      <p>
        <a href="https://github.com/isox-sh/isox/releases">Browse all releases on GitHub →</a>
      </p>
    </div>
  )
}
