import { readFile, realpath } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { dirname, join, resolve } from 'node:path'

import { digest, slash, snapshot, statIfExists } from './files'
import { createToolIndex } from './tool-index'

interface InstalledVersionsOptions {
  root?: string
  developmentManifests?: string[]
}

async function existingManifest(file: string): Promise<string | undefined> {
  try {
    return await realpath(file)
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
      throw error
    }

    return undefined
  }
}

/** Record installed versions as well as the lockfile: a stale installation must miss. */
export async function installedVersions(manifests: string[], options: InstalledVersionsOptions = {}): Promise<unknown> {
  const index = await createToolIndex(options.root)
  const pending = [...new Set((await Promise.all(manifests.map(existingManifest))).filter(file => file !== undefined))]
  const development = new Set(await Promise.all((options.developmentManifests ?? manifests).map(existingManifest)))
  const seen = new Set(pending)
  const versions = new Map<string, string | null>()

  const inspect = async (actual: string): Promise<void> => {
    const contents = await readFile(actual, 'utf8')
    const manifest = JSON.parse(contents)

    versions.set(actual, digest(contents))
    const dependencies = {
      ...manifest.dependencies,
      // Workspace tools can be development dependencies. An installed tool's
      // own development dependencies are not part of its runtime contract.
      ...(development.has(actual) ? manifest.devDependencies : {}),
      ...manifest.peerDependencies,
      ...manifest.optionalDependencies,
    }

    for (const dependency of Object.keys(dependencies).sort()) {
      let resolved: string | undefined

      try {
        resolved = dependency === manifest.name ? actual : await index.resolveManifest(dependency, actual)
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'MODULE_NOT_FOUND') {
          throw error
        }
      }

      if (!resolved) {
        versions.set(`${actual}:${dependency}`, null)
      } else if (!seen.has(resolved)) {
        seen.add(resolved)
        pending.push(resolved)
      }
    }
  }

  // Bound concurrent reads, and rebuild this graph on every hash. Reusing a
  // previous resolution could hide an installation changed during execution.
  let offset = 0

  while (offset < pending.length) {
    const batch = pending.slice(offset, offset + 16)

    offset += batch.length
    await Promise.all(batch.map(inspect))
  }

  await index.save()

  return [...versions.entries()].sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0)
}

export async function executorFiles(manifestFile: string, executor: string): Promise<unknown> {
  const manifest = JSON.parse(await readFile(manifestFile, 'utf8'))
  const registryFile = resolve(dirname(manifestFile), manifest.executors)
  const registry = JSON.parse(await readFile(registryFile, 'utf8'))
  const implementation = registry.executors[executor.split(':')[1]].implementation
  const implementationFile = createRequire(manifestFile).resolve(resolve(dirname(registryFile), implementation))
  let runtimeRoot = dirname(implementationFile)

  // Local plugins can point their registry at compiled files outside the source
  // package. Hash that installed package too, including its helper modules.
  while (!await statIfExists(join(runtimeRoot, 'package.json')) && dirname(runtimeRoot) !== runtimeRoot) {
    runtimeRoot = dirname(runtimeRoot)
  }

  if (dirname(runtimeRoot) === runtimeRoot) {
    throw new Error(`Cannot locate the executor's runtime package: ${implementationFile}`)
  }

  // Core owns execution and cache semantics too, even for third-party plugins.
  const roots = new Set([await realpath(dirname(manifestFile)), await realpath(runtimeRoot), await realpath(resolve(__dirname, '..'))])
  const trees = []

  for (const root of roots) {
    trees.push({
      root,
      files: await snapshot(root, path => slash(path.slice(root.length + 1)).split('/').some(part => ['node_modules', '.git', '.isox'].includes(part)))
    })
  }

  return trees
}
