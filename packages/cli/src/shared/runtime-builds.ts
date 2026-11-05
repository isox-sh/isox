import { readFile } from 'node:fs/promises'
import { dirname, extname, isAbsolute, relative, resolve, sep } from 'node:path'

import { outputPaths, resolvePackageJson } from '@isox-sh/core'

import type { WorkspaceGraph } from '@isox-sh/core'

/** Find builds that replace the CLI or an executor needed by the other workers. */
export async function runtimeBuilds(root: string, workspace: WorkspaceGraph, projects: string[], target: string): Promise<Set<string>> {
  const files = new Set(Object.keys(require.cache))
  const executors = new Set(projects.map(name => workspace.projects[name].targets![target].executor))

  for (const executor of executors) {
    const [packageName, name] = executor.split(':')
    const candidates = !packageName.startsWith('@') && !packageName.includes('/')
      ? [`@isox-sh/${packageName}`, packageName]
      : [packageName]
    let manifestFile: string | undefined

    for (const candidate of candidates) {
      try {
        manifestFile = resolvePackageJson(candidate, root)
        break
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'MODULE_NOT_FOUND') {
          throw error
        }
      }
    }

    if (!manifestFile) {
      continue // The worker reports invalid or missing executor packages.
    }

    files.add(manifestFile)
    const manifest = JSON.parse(await readFile(manifestFile, 'utf8'))

    if (typeof manifest.executors !== 'string') {
      continue
    }

    const registryFile = resolve(dirname(manifestFile), manifest.executors)

    files.add(registryFile)
    // JavaScript registries are valid too, but must only execute inside workers.
    if (extname(registryFile) !== '.json') {
      continue
    }

    const registry = JSON.parse(await readFile(registryFile, 'utf8'))
    const implementation = registry.executors?.[name]?.implementation

    if (typeof implementation === 'string') {
      files.add(resolve(dirname(registryFile), implementation))
    }
  }

  return new Set(projects.filter(name => {
    const project = workspace.projects[name]
    const command = project.targets![target]

    return command.cache === true && outputPaths(command, project.root, name).some(output => {
      const directory = resolve(root, output)

      return [...files].some(file => {
        const path = relative(directory, file)

        return path === '' || (path !== '..' && !path.startsWith(`..${sep}`) && !isAbsolute(path))
      })
    })
  }))
}
