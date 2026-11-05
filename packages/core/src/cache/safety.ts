import { execFile } from 'node:child_process'
import { dirname, join, resolve } from 'node:path'
import { promisify } from 'node:util'

import { noSymlinks, statIfExists } from './files'

const exec = promisify(execFile)

/** Never treat version-controlled files as disposable build artifacts. */
export async function assertDisposableOutputs(root: string, outputs: string[]): Promise<void> {
  if (!outputs.length) {
    return
  }

  for (const output of outputs) {
    await noSymlinks(root, resolve(root, output))
  }

  let directory = root

  while (!await statIfExists(join(directory, '.git'))) {
    const parent = dirname(directory)

    if (parent === directory) {
      return
    }

    directory = parent
  }

  // Inherited Git overrides must not redirect the check to a different index.
  const env = Object.fromEntries(Object.entries(process.env).filter(([key]) => !key.startsWith('GIT_')))
  const { stdout } = await exec('git', ['ls-files', '--cached', '-z', '--', ...outputs.map(path => `:(icase,literal)${path}`)], {
    cwd: root,
    env,
    encoding: 'utf8',
    maxBuffer: 16 * 1024 * 1024
  })

  if (stdout) {
    throw new Error(`Task output contains Git-tracked files: ${stdout.split('\0')[0]}. Choose a generated directory outside tracked files.`)
  }
}
