import { lstat, readFile } from 'node:fs/promises'
import { isAbsolute, relative, resolve } from 'node:path'

import fg from 'fast-glob'

import { canonical, inside, safeDestination, slash } from './files'

import type { TscOptions } from './options'
import type { ExecutorContext } from '@isox-sh/core'

export async function collectAssets(options: TscOptions, context: ExecutorContext, outDir: string, roots: string[]) {
  const assets = new Map<string, Buffer>()

  for (const pattern of options.assets ?? []) {
    const input = resolve(context.workspaceRoot, pattern.input)
    const actualInput = await canonical(input)

    if (!inside(context.workspaceRoot, actualInput) || input !== actualInput) {
      throw new Error(`Unsafe asset input: ${input}`)
    }

    if (isAbsolute(pattern.glob) || slash(pattern.glob).split('/').includes('..')) {
      throw new Error('Asset globs must stay inside their input directory.')
    }

    const output = resolve(outDir, pattern.output ?? '.')

    if (!inside(outDir, output)) {
      throw new Error(`Unsafe asset output: ${output}`)
    }

    const outputPatterns = roots
      .filter(root => inside(input, root))
      .map(root => `${fg.escapePath(slash(relative(input, root)))}/**`)

    for (const file of await fg(pattern.glob, {
      cwd: input,
      dot: true,
      followSymbolicLinks: false,
      onlyFiles: false,
      ignore: [
        '**/node_modules/**',
        '**/.git/**',
        '**/.isox/**',
        ...(pattern.ignore ?? []),
        ...outputPatterns,
      ],
    })) {
      const source = resolve(input, file)
      const entry = await lstat(source)

      if (entry.isSymbolicLink() || !inside(actualInput, await canonical(source))) {
        throw new Error(`Symlink in asset input: ${source}`)
      }

      if (entry.isDirectory()) {
        continue
      }

      const target = resolve(output, file)

      await safeDestination(target, roots)

      if (assets.has(target)) {
        throw new Error(`Asset collision at ${target}`)
      }

      assets.set(target, await readFile(source))
    }
  }

  return assets
}
