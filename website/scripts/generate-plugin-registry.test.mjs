import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { copyFile, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'

test('registry generation validates entries and detects stale data', async (t) => {
  const root = await mkdtemp(join(tmpdir(), 'isox-registry-'))
  t.after(() => rm(root, {
    recursive: true,
    force: true
  }))
  await mkdir(join(root, 'scripts'))
  await mkdir(join(root, 'snippets'))
  await mkdir(join(root, 'docs'))
  const script = join(root, 'scripts/generate-plugin-registry.mjs')
  await copyFile(new URL('./generate-plugin-registry.mjs', import.meta.url), script)
  const source = join(root, 'approved-community-plugins.json')
  const output = join(root, 'snippets/plugin-registry-data.mdx')
  const plugin = {
    name: '@example/isox-plugin',
    description: 'Build example projects.',
    url: 'https://github.com/example/isox-plugin',
    docs: '/docs/example',
    category: 'Build',
    official: false,
  }
  const run = (...args) => spawnSync(process.execPath, [script, ...args], { encoding: 'utf8' })
  await writeFile(source, JSON.stringify([plugin]))
  await writeFile(join(root, 'docs/example.mdx'), '# Example\n')

  assert.notEqual(run('--check').status, 0, 'missing generated output must fail')
  assert.equal(run().status, 0)
  assert.equal(run('--check').status, 0)
  const generated = await readFile(output, 'utf8')
  const { plugins } = await import(`data:text/javascript,${encodeURIComponent(generated)}`)
  assert.deepEqual(plugins, [plugin])

  await writeFile(source, JSON.stringify([{
    ...plugin,
    description: 'Updated description.'
  }]))
  assert.match(run('--check').stderr, /out of date/)
  assert.equal(await readFile(output, 'utf8'), generated, '--check must not rewrite output')

  for (const [label, entries] of [
    ['duplicate', [plugin, plugin]],
    ['unsafe URL', [{
      ...plugin,
      url: 'javascript:alert(1)'
    }]],
    ['invalid package', [{
      ...plugin,
      name: 'not a package'
    }]],
    ['missing description', [{
      ...plugin,
      description: ''
    }]],
    ['missing maintainer', [{
      ...plugin,
      official: undefined
    }]],
    ['missing guide', [{
      ...plugin,
      docs: '/docs/missing'
    }]],
    ['invalid data shape', {}],
  ]) {
    await writeFile(source, JSON.stringify(entries))
    assert.notEqual(run().status, 0, label)
    assert.equal(await readFile(output, 'utf8'), generated, `${label} must not overwrite output`)
  }

  const withoutDocs = { ...plugin }
  delete withoutDocs.docs
  await writeFile(source, JSON.stringify([withoutDocs]))
  assert.equal(run().status, 0, 'documentation is optional')
})
