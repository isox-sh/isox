import { parseArgs } from 'node:util'

import type { CAC } from 'cac'
import type { ParseArgsConfig } from 'node:util'

/** CAC coerces numeric option values; recover the original strings before invoking actions. */
export function preserveOptionValues(cli: CAC): void {
  if (!cli.matchedCommand) {
    return
  }

  cli.matchedCommand.checkOptionValue()

  const definitions = [...cli.globalCommand.options, ...cli.matchedCommand.options]
  const options: NonNullable<ParseArgsConfig['options']> = Object.create(null)
  const aliases = new Map<string, typeof definitions[number]>()

  for (const definition of definitions) {
    const flags = definition.rawName.split(/[ ,]+/).filter(flag => flag.startsWith('-'))

    for (const name of [...definition.names, ...flags.map(flag => flag.replace(/^-+/, ''))]) {
      options[name] = { type: definition.required ? 'string' : 'boolean' }
      aliases.set(name, definition)
    }
  }

  const args = cli.rawArgs.slice(2)
  const { tokens } = parseArgs({
    args,
    options,
    strict: false,
    allowPositionals: true,
    tokens: true
  })
  const values = new Map<string, string[]>()

  for (const token of tokens) {
    if (token.kind !== 'option') {
      continue
    }

    const definition = aliases.get(token.name)

    const booleanDefinition = definition ?? (token.name.startsWith('no-') ? aliases.get(token.name.slice(3)) : undefined)

    if (booleanDefinition?.isBoolean && ['init', 'add'].includes(cli.matchedCommand.name)
      && !cli.globalCommand.options.includes(booleanDefinition)) {
      // Boolean flags follow command-line order, including explicit values and negations.
      cli.options[booleanDefinition.name] = token.name.startsWith('no-') ? false : token.value ?? true
      continue
    }

    if (!definition || definition.isBoolean) {
      continue
    }

    // Node includes the assignment separator in short options (-c=acc); CAC does not.
    let value = token.inlineValue && token.rawName.length === 2 && token.value?.startsWith('=')
      ? token.value.slice(1)
      : token.value

    // parseArgs has no optional string type. Read a following positional value ourselves.
    if (!definition.required && !token.inlineValue) {
      const next = args[token.index + 1]
      value = next && !next.startsWith('-') ? next : undefined
    }

    if (value === undefined && !definition.required) {
      continue
    }

    if (value === undefined || value === '') {
      throw new Error(`option \`${definition.rawName}\` value is missing`)
    }

    const entries = values.get(definition.name) ?? []

    entries.push(value)
    values.set(definition.name, entries)
    for (const name of definition.names) {
      cli.options[name] = entries.length === 1 ? entries[0] : entries
    }
  }
}
