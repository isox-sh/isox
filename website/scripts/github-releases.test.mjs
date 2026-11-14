import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { test } from 'node:test'

// Mintlify supplies JSX components and hooks. Import the pure helpers separately
// so these checks use Node's test runner without adding a second React runtime.
const source = await readFile(new URL('../snippets/github-releases.jsx', import.meta.url), 'utf8')
const helpers = source.slice(0, source.indexOf('export const GitHubReleases ='))
const { formatReleaseNotes, fetchReleases } = await import(`data:text/javascript,${encodeURIComponent(helpers)}`)

test('removes only a redundant version heading from GitHub-rendered notes', () => {
  const notes = '<h3>Features</h3><ul><li><strong>core:</strong> New feature</li></ul>'
  for (const heading of [
    '<h2>1.0.0-alpha.7 (2026-11-12)</h2>\n',
    '<h1>v1.0.0-alpha.7</h1>',
    '<h2><a href="https://github.com/isox-sh/isox/compare/v1...v2">1.0.0-alpha.7 (2026-11-12)</a></h2>'
  ]) {
    assert.equal(formatReleaseNotes({
      tag_name: 'v1.0.0-alpha.7',
      body_html: heading + notes
    }), notes)
  }

  for (const body_html of [notes, '<h2>Upgrade instructions</h2>' + notes, '<h2>1.0.0-alpha.6</h2>' + notes]) {
    assert.equal(formatReleaseNotes({
      tag_name: 'v1.0.0-alpha.7',
      body_html
    }), body_html)
  }

  assert.equal(formatReleaseNotes({}), '')
})

test('fetches paginated Isox release HTML and retains prereleases while hiding drafts', async (t) => {
  const releases = Array.from({ length: 10 }, (_, id) => ({
    id,
    draft: id === 0,
    prerelease: id === 1
  }))
  const signal = new AbortController().signal
  t.mock.method(globalThis, 'fetch', async (url, options) => {
    assert.equal(url, 'https://api.github.com/repos/isox-sh/isox/releases?per_page=10&page=2')
    assert.equal(options.headers.Accept, 'application/vnd.github.html+json')
    assert.equal(options.signal, signal)

    return {
      ok: true,
      json: async () => releases
    }
  })
  const result = await fetchReleases(2, signal)
  assert.deepEqual(result.releases, releases.slice(1))
  assert.equal(result.releases[0].prerelease, true)
  assert.equal(result.hasMore, true)
})

test('stops pagination on a short or empty page', async (t) => {
  for (const releases of [[], [{ id: 1 }]]) {
    t.mock.method(globalThis, 'fetch', async () => ({
      ok: true,
      json: async () => releases
    }))
    assert.deepEqual(await fetchReleases(1), {
      releases,
      hasMore: false
    })
    t.mock.restoreAll()
  }
})

test('reports API errors, malformed responses, and cancellation to the caller', async (t) => {
  for (const response of [{ ok: false }, {
    ok: true,
    json: async () => ({ message: 'Rate limit exceeded' })
  }]) {
    t.mock.method(globalThis, 'fetch', async () => response)
    await assert.rejects(fetchReleases(1), /Unable to load releases|Invalid releases response/)
    t.mock.restoreAll()
  }

  const controller = new AbortController()
  controller.abort()
  t.mock.method(globalThis, 'fetch', async (_url, { signal }) => signal.throwIfAborted())
  await assert.rejects(fetchReleases(1, controller.signal), { name: 'AbortError' })
})
