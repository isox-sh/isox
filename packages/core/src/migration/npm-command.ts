import { existsSync } from 'node:fs'
import { dirname, join } from 'node:path'

export function npmCommand(
  platform: NodeJS.Platform = process.platform,
  executable = process.execPath,
  searchPath = process.env.PATH ?? '',
): [string, string[]] {
  if (platform !== 'win32') {
    return ['npm', []]
  }

  // Respect PATH precedence. Windows .cmd launchers cannot be passed to execFile,
  // so invoke the corresponding npm JS entry with Node instead of using a shell.
  for (const directory of [...searchPath.split(';').filter(Boolean), dirname(executable)]) {
    const script = join(directory, 'node_modules', 'npm', 'bin', 'npm-cli.js')
    if (existsSync(script)) {
      return [executable, [script]]
    }
  }

  throw new Error('Cannot locate npm. Install Node.js with npm and add it to PATH.')
}
