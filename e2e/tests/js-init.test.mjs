import assert from 'node:assert/strict'
import { readdir, readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'

import { json, readJson } from '@isox-sh/core'
import { createWorkspace } from '@isox-sh/e2e'
import { test } from 'vitest'

for (const pathStyle of ['relative', 'absolute']) {
  test(`initializes a workspace and JS project, builds and runs its output (${pathStyle} path)`, async (t) => {
    const { root, version, runIsox, runNode, cleanup } = await createWorkspace({
      startDirectory: import.meta.dirname,
      plugins: { '@isox-sh/js': 'dist/js' },
    })
    t.onTestFinished(cleanup)
    const workspaceContext = { projectRoot: root }
    assert.ok(!(await readdir(root)).includes('isox.json'))

    await runIsox(['init'])
    assert.deepEqual(await readJson('isox.json', workspaceContext), { version })

    const projectRoot = join(root, 'packages/test')
    const projectContext = { projectRoot }
    const outputRoot = join(root, 'dist/packages/test')
    const projectPath = pathStyle === 'absolute' ? projectRoot : 'packages/test'
    await runIsox(['init', '@isox-sh/js', projectPath, '--importPath=@org/test'])
    const project = await readJson('project.json', projectContext)
    assert.equal(project.name, 'test')
    assert.equal(project.targets.build.executor, '@isox-sh/js:tsc')
    assert.deepEqual((await readJson('tsconfig.base.json', workspaceContext)).compilerOptions.paths, {
      '@org/test': ['./packages/test/src/index.ts'],
    })
    const tsconfig = await readJson('tsconfig.build.json', projectContext)
    assert.equal(tsconfig.extends, '../../tsconfig.base.json')
    assert.equal(tsconfig.compilerOptions.outDir, '../../dist/packages/test')

    // Build the scaffold as generated, without hand-writing any Isox configuration.
    await runIsox(['build', 'test'])
    assert.deepEqual((await readdir(outputRoot)).sort(), ['index.d.ts', 'index.js'])
    assert.ok(!(await readdir(projectRoot)).includes('dist'))
    const empty = await runNode(['--eval', 'process.stdout.write(require("@isox-sh/core").json(require("./dist/packages/test/index.js")))'])
    assert.equal(empty.stdout, json({}))

    // Compile real TypeScript and execute the emitted JavaScript in a fresh process.
    const source = `export function greet(name: string): string {
  return 'Hello, ' + name
}
`
    await writeFile(join(projectRoot, 'src/index.ts'), source)
    await runIsox(['build', 'test'], join(projectRoot, 'src'))
    assert.match(await readFile(join(outputRoot, 'index.d.ts'), 'utf8'), /greet\(name: string\): string/)
    const executeOutput = () => runNode(['--eval', 'console.log(require("./dist/packages/test/index.js").greet("Isox"))'])
    assert.equal((await executeOutput()).stdout.trim(), 'Hello, Isox')

    // A successful rebuild must replace the previous output, not merely reuse it.
    await writeFile(join(projectRoot, 'src/index.ts'), source.replace('Hello, ', 'Updated, '))
    await runIsox(['build', 'test'])
    assert.equal((await executeOutput()).stdout.trim(), 'Updated, Isox')
  })
}
