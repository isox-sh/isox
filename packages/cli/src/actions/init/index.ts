import { readFile, rm, stat, writeFile } from 'node:fs/promises'
import { join } from 'node:path'

import { addDepsToPackageJson, defaultNamedInputs, logger } from '@isox-sh/core'

import { getExecutorOverrides } from '../../shared/executor-options'
import { initializeProject } from './project'

import type { CAC } from 'cac'

interface CliPackageManifest {
  version: string
}

export function registerInitAction(cli: CAC): void {
  cli
    .command('init [package] [path]', 'Create a workspace, or initialize a project in an existing workspace')
    .allowUnknownOptions()
    .option('--options <json>', 'Generator options as a JSON object')
    .action(async (packageName: string | undefined, projectPath: string | undefined) => {
      const options = getExecutorOverrides(cli)

      if (packageName !== undefined || projectPath !== undefined) {
        if (!packageName || !projectPath) {
          throw new Error('Project initialization requires both a package and a path. Use isox init <package> <path>.')
        }

        await initializeProject(packageName, projectPath, options)

        return
      }

      if (Object.keys(options).length > 0) {
        throw new Error('Generator options require a package and a project path.')
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
        namedInputs: defaultNamedInputs(),
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
