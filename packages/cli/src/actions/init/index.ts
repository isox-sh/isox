import { readFile, rm, stat, writeFile } from 'node:fs/promises'
import { join } from 'node:path'

import { addDepsToPackageJson, logger } from '@isox-sh/core'

import { initializeProject } from './project'

import type { InitializerOptions } from '@isox-sh/core'
import type { CAC } from 'cac'

interface CliPackageManifest {
  version: string
}

export function registerInitAction(cli: CAC): void {
  cli
    .command('init [package] [path]', 'Create a workspace, or initialize a project in an existing workspace')
    .option('--importPath <name>', 'Add a project import alias to tsconfig.base.json')
    .action(async (packageName: string | undefined, projectPath: string | undefined, options: InitializerOptions) => {
      if (packageName !== undefined || projectPath !== undefined) {
        if (!packageName || !projectPath) {
          throw new Error('Project initialization requires both a package and a path. Use isox init <package> <path>.')
        }

        await initializeProject(packageName, projectPath, options)

        return
      }

      if (options.importPath !== undefined) {
        throw new Error('--importPath requires a package and a project path.')
      }

      const { version } = JSON.parse(await readFile(join(__dirname, '../../package.json'), 'utf8')) as CliPackageManifest
      const file = join(process.cwd(), 'isox.json')
      let hasNx = false

      try {
        hasNx = (await stat(join(process.cwd(), 'nx.json'))).isFile()

      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
          throw error
        }
      }

      const settings = {
        version,
        ...(hasNx ? { nx: { executors: ['@nx'] } } : {})
      }

      try {
        await writeFile(file, `${JSON.stringify(settings, null, 2)}\n`, { flag: 'wx' })

      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === 'EEXIST') {
          throw new Error(`Cannot initialize: ${file} already exists.`, { cause: error })
        }

        throw error
      }

      if (hasNx) {
        try {
          await addDepsToPackageJson({ devDependencies: { '@isox-sh/nx': version } }, {
            projectRoot: process.cwd(),
            workspaceRoot: process.cwd(),
            logger,
          })
        } catch (error) {
          // Leave initialization retryable if package.json cannot be updated.
          await rm(file, { force: true })
          throw error
        }
      }

      logger.success(`Created ${file}`)
    })
}
