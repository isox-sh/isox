import { existsSync, realpathSync } from 'node:fs'
import { createRequire } from 'node:module'
import { join, resolve } from 'node:path'

/** Locate plugin metadata even when its exports map only exposes the public API. */
export function resolvePackageJson(packageName: string, workspaceRoot: string): string {
  const localRequire = createRequire(resolve(workspaceRoot, 'package.json'))
  try {
    return localRequire.resolve(`${packageName}/package.json`)
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ERR_PACKAGE_PATH_NOT_EXPORTED'
      || !/^(?:@[^/]+\/)?[^/]+$/.test(packageName)) {
      throw error
    }
    for (const directory of localRequire.resolve.paths(packageName) ?? []) {
      const file = join(directory, packageName, 'package.json')
      if (existsSync(file)) {
        return realpathSync(file)
      }
    }
    throw error
  }
}
