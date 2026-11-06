import { readFile, writeFile } from 'node:fs/promises'

const source = new URL('../approved-community-plugins.json', import.meta.url)
const output = new URL('../snippets/plugin-registry-data.mdx', import.meta.url)
const plugins = JSON.parse(await readFile(source, 'utf8'))
const names = new Set()

if (!Array.isArray(plugins)) {
  throw new Error('Plugin registry must be an array.')
}

for (const plugin of plugins) {
  if (!plugin || typeof plugin !== 'object') {
    throw new Error('Each plugin must be an object.')
  }

  for (const field of ['name', 'description', 'url', 'category']) {
    if (typeof plugin[field] !== 'string' || !plugin[field].trim()) {
      throw new Error(`Plugin ${plugin.name ?? '(unnamed)'} requires a non-empty ${field}.`)
    }
  }
  if (!/^(?:@[a-z0-9][a-z0-9._-]*\/)?[a-z0-9][a-z0-9._-]*$/.test(plugin.name) || names.has(plugin.name)) {
    throw new Error(`Invalid or duplicate package name: ${plugin.name}`)
  }

  names.add(plugin.name)
  if (typeof plugin.official !== 'boolean') {
    throw new Error(`${plugin.name}: official must be true or false.`)
  }

  if (new URL(plugin.url).protocol !== 'https:') {
    throw new Error(`${plugin.name}: url must use HTTPS.`)
  }

  if (plugin.docs !== undefined) {
    if (typeof plugin.docs !== 'string' || !/^(\/docs\/[a-z0-9/-]+|https:\/\/\S+)$/.test(plugin.docs)) {
      throw new Error(`${plugin.name}: docs must be a /docs/ path or HTTPS URL.`)
    }

    if (plugin.docs.startsWith('/docs/')) {
      const page = `../${plugin.docs.slice(1)}`
      await readFile(new URL(`${page}.md`, import.meta.url))
        .catch(() => readFile(new URL(`${page}.mdx`, import.meta.url)))
    } else if (new URL(plugin.docs).protocol !== 'https:') {
      throw new Error(`${plugin.name}: docs must use HTTPS.`)
    }
  }
}

const generated = `export const plugins = ${JSON.stringify(plugins, null, 2)}\n`
if (process.argv.includes('--check')) {
  const current = await readFile(output, 'utf8').catch(() => '')
  if (current !== generated) {
    throw new Error('Plugin registry is out of date. Run: node website/scripts/generate-plugin-registry.mjs')
  }

  console.log(`Plugin registry is current (${plugins.length} packages).`)
} else {
  await writeFile(output, generated)
  console.log(`Generated plugin registry (${plugins.length} packages).`)
}
