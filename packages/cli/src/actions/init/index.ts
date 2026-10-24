import { readFile, stat, writeFile } from 'node:fs/promises'
import { join } from 'node:path'

import { logger } from '@isox-sh/core'

import type { CAC } from 'cac'

export function registerInitAction(cli: CAC): void {
  cli
    .command('init', 'Create a versioned isox.json in the current directory')
    .action(async () => {
      const { version } = JSON.parse(await readFile(join(__dirname, '../../../package.json'), 'utf8')) as { version: string }
      const file = join(process.cwd(), 'isox.json')
      let hasNx = false
      try {
        hasNx = (await stat(join(process.cwd(), 'nx.json'))).isFile()
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
      }
      const settings = { version, ...(hasNx ? { nx: { executors: ['@nx'] } } : {}) }
      try {
        await writeFile(file, `${JSON.stringify(settings, null, 2)}\n`, { flag: 'wx' })
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === 'EEXIST') {
          throw new Error(`Cannot initialize: ${file} already exists.`, { cause: error })
        }
        throw error
      }
      logger.success(`Created ${file}`)
    })
}
