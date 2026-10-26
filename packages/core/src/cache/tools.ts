import { readFile, realpath } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { dirname, join, resolve } from 'node:path'

import { resolvePackageJson } from '../utils/resolve-package-json'
import { digest, slash, snapshot, statIfExists } from './files'

/** Record installed versions as well as the lockfile: a stale installation must miss. */
export async function installedVersions(manifests: string[]): Promise<unknown> {
  const pending = new Set(manifests)
  const versions = new Map<string, unknown>()

  for (const file of pending) {
    if (!await statIfExists(file)) {
      continue
    }

    const actual = await realpath(file)

    if (versions.has(actual)) {
      continue
    }

    const contents = await readFile(actual, 'utf8')
    const manifest = JSON.parse(contents)

    versions.set(actual, digest(contents))
    const dependencies = {
      ...manifest.dependencies,
      ...manifest.devDependencies,
      ...manifest.peerDependencies,
      ...manifest.optionalDependencies,
    }

    for (const dependency of Object.keys(dependencies).sort()) {
      try {
        pending.add(resolvePackageJson(dependency, dirname(actual)))
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'MODULE_NOT_FOUND') {
          throw error
        }

        versions.set(`${actual}:${dependency}`, null)
      }
    }
  }

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
