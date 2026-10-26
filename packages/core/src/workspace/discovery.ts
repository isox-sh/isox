import { readdir, readFile } from 'node:fs/promises'
import { join, posix } from 'node:path'

import ignore from 'ignore'

import type { Ignore } from 'ignore'

interface DiscoveryOptions {
  sources?: boolean
}

export interface DiscoveryFiles {
  projects: string[]
  sources: string[]
}

interface ScopedIgnore {
  root: string
  rules: Ignore
}

// Always exclude dependency installations, Git internals and our own cache.
const boundaries = new Set(['node_modules', '.git', '.isox'])
const sourcePattern = /\.(?:[cm]?[jt]s|[jt]sx)$/

function gitIgnored(path: string, scopes: ScopedIgnore[]): boolean {
  let ignored = false

  for (const { root, rules } of scopes) {
    const result = rules.test(root ? path.slice(root.length + 1) : path)

    if (result.ignored || result.unignored) {
      ignored = result.ignored
    }
  }

  return ignored
}

/** Apply Git ignore rules while walking, so ignored trees and symlink loops are never traversed. */
export async function discoverWorkspace(root: string, options: DiscoveryOptions = {}): Promise<DiscoveryFiles> {
  const projects: string[] = []
  const sources: string[] = []
  let isoxIgnore = ignore({ ignorecase: false })
  const walk = async (directory: string, inherited: ScopedIgnore[]): Promise<void> => {
    const entries = (await readdir(join(root, directory), { withFileTypes: true })).sort((a, b) => a.name < b.name ? -1 : a.name > b.name ? 1 : 0)
    const regularFile = (name: string) => entries.some(entry => entry.name === name && entry.isFile())

    if (directory && regularFile('isox.json')) {
      return
    }

    const scopes = [...inherited]

    if (regularFile('.gitignore')) {
      const file = posix.join(directory, '.gitignore')
      const content = await readFile(join(root, file))

      scopes.push({
        root: directory,
        rules: ignore({ ignorecase: false }).add(content.toString())
      })
    }

    if (!directory && regularFile('.isoxignore')) {
      const content = await readFile(join(root, '.isoxignore'))

      isoxIgnore = ignore({ ignorecase: false }).add(content.toString())
    }

    for (const entry of entries) {
      if (entry.isSymbolicLink() || boundaries.has(entry.name)) {
        continue
      }

      const file = posix.join(directory, entry.name)
      const pattern = entry.isDirectory() ? `${file}/` : file

      if (gitIgnored(pattern, scopes) || isoxIgnore.ignores(pattern)) {
        continue
      }

      if (entry.isDirectory()) {
        await walk(file, scopes)
        continue
      }

      if (!entry.isFile()) {
        continue
      }

      if (entry.name === 'project.json') {
        projects.push(file)
      }

      if (options.sources && sourcePattern.test(file)) {
        sources.push(join(root, file))
      }
    }
  }

  await walk('', [])

  return {
    projects,
    sources
  }
}
