import { createHash, randomUUID } from 'node:crypto'
import { lstat, rename, rm } from 'node:fs/promises'
import { isAbsolute, join, relative, resolve, sep } from 'node:path'

import { actionMain, input, setOutput } from '../shared/runtime.mjs'

export function cacheSettings({ root, directory = '.', namespace = 'isox-v1', platform, arch }) {
  const workspace = resolve(root, directory)
  const location = relative(resolve(root), workspace)

  if (location === '..' || location.startsWith(`..${sep}`) || isAbsolute(location)) {
    throw new Error('workingDirectory must be inside GITHUB_WORKSPACE.')
  }

  if (!/^[a-zA-Z0-9_.-]{1,100}$/.test(namespace)) {
    throw new Error('prefix must contain 1–100 letters, numbers, dots, underscores, or hyphens.')
  }

  if (!platform || !arch) {
    throw new Error('RUNNER_OS and RUNNER_ARCH are required when caching Isox state.')
  }

  if (/[\r\n]/.test(workspace)) {
    throw new Error('workingDirectory must fit on one line.')
  }

  const workspaceId = createHash('sha256').update(location.split(sep).join('/')).digest('hex').slice(0, 16)
  const prefix = `${namespace}-${platform}-${arch}-${workspaceId}-`

  return {
    path: join(workspace, '.isox'),
    prefix,
    // Entries are immutable: every job saves a new snapshot in the shared family.
    key: `${prefix}${randomUUID()}`
  }
}

export async function refreshDefinitions(path) {
  const file = join(path, 'workspace.json')

  try {
    // Match core's recovery behavior without deleting unexpected directory contents.
    if ((await lstat(file)).isDirectory()) {
      await rename(file, `${file}.${randomUUID()}.invalid`)
    } else {
      await rm(file, { force: true })
    }
  } catch (error) {
    if (error.code !== 'ENOENT') {
      throw error
    }
  }
}

export async function main() {
  if (process.argv[2] === 'refresh') {
    await refreshDefinitions(process.env.ISOX_CACHE_PATH)

    return
  }

  const settings = cacheSettings({
    root: process.env.GITHUB_WORKSPACE || process.cwd(),
    directory: input('workingDirectory', '.'),
    namespace: input('prefix', 'isox-v1'),
    platform: process.env.RUNNER_OS,
    arch: process.env.RUNNER_ARCH
  })

  for (const [name, value] of Object.entries(settings)) {
    setOutput(name, value)
  }
}

actionMain(import.meta.url, main)
