import { createRequire } from 'node:module'
import { parseArgs } from 'node:util'

import { findWorkspaceRoot, resolvePackageJson } from '@isox-sh/core'

import { generatorSchema } from './generators'

import type { CAC } from 'cac'

/** Register plugin flags before CAC decides which tokens are positional arguments. */
export async function registerGeneratorOptions(cli: CAC, argv: string[]): Promise<void> {
  const { positionals, tokens } = parseArgs({
    args: argv.slice(2),
    options: {
      verbose: { type: 'boolean' },
      help: { type: 'boolean' },
      options: { type: 'string' }
    },
    strict: false,
    allowPositionals: true,
    tokens: true,
  })
  const name = positionals[0]

  if (name !== 'init' && name !== 'add') {
    return
  }

  let workspaceRoot: string

  try {
    workspaceRoot = await findWorkspaceRoot()
  } catch {
    // Plain init and commands outside a workspace retain their existing errors.
    return
  }

  for (const candidate of positionals.slice(1)) {
    let packageFile: string

    try {
      packageFile = resolvePackageJson(candidate, workspaceRoot)
    } catch (error) {
      if (!['MODULE_NOT_FOUND', 'ERR_PACKAGE_PATH_NOT_EXPORTED'].includes((error as NodeJS.ErrnoException).code ?? '')) {
        throw error
      }

      continue
    }

    const require = createRequire(packageFile)

    if (!require(packageFile).generators) {
      continue
    }

    const schema = generatorSchema(candidate, name, workspaceRoot)
    const command = cli.commands.find(command => command.name === name)!

    for (const [property, definition] of Object.entries(schema.properties ?? {})) {
      if (command.hasOption(property) || cli.globalCommand.hasOption(property)) {
        continue
      }

      const option = definition as Record<string, unknown>
      command.option(`--${property}${option.type === 'boolean' ? '' : ' <value>'}`, String(option.description ?? ''))
    }

    for (const token of tokens) {
      if (token.kind !== 'option') {
        continue
      }

      const negated = token.name.startsWith('no-')
      const property = (negated ? token.name.slice(3) : token.name).replace(/-([a-z0-9])/g, (_, letter: string) => letter.toUpperCase())

      if (Object.hasOwn(schema.properties ?? {}, property)) {
        if (schema.properties[property].type === 'boolean' && token.inlineValue && !['true', 'false'].includes(token.value ?? '')) {
          throw new Error(`Invalid options for ${candidate}:${name}: options.${property} must be boolean`)
        }

        argv[token.index + 2] = `--${negated ? 'no-' : ''}${property}${token.inlineValue ? `=${token.value}` : ''}`
      }
    }

    return
  }
}
