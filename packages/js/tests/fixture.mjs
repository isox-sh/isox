import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'

const require = createRequire(import.meta.url)
const { createLogger, LogLevels } = require('@isox-sh/core')

export const { default: tsc } = require('../../../dist/js/executors/tsc/tsc.executor')

export async function fixture(t) {
  const root = await mkdtemp(join(tmpdir(), 'isox compiler '))

  t.onTestFinished(() => rm(root, {
    recursive: true,
    force: true
  }))
  const projectRoot = join(root, 'packages/demo package')
  const config = {
    compilerOptions: {
      target: 'ES2022',
      module: 'NodeNext',
      rootDir: 'src',
      outDir: 'dist',
      declaration: true,
      types: []
    },
    include: ['src/**/*'],
  }
  const write = async (file, value) => {
    const path = resolve(projectRoot, file)

    await mkdir(dirname(path), { recursive: true })
    await writeFile(path, typeof value === 'string' ? value : JSON.stringify(value))
  }

  await write('tsconfig.json', config)
  await write('src/index.ts', 'export const answer: number = 42')
  const logs = []
  const context = {
    workspaceRoot: root,
    projectRoot,
    projectName: 'demo',
    commandName: 'build',
    verbose: false,
    logger: createLogger({
      level: LogLevels.debug,
      reporters: [{ log: entry => logs.push(entry) }]
    }),
    workspace: {
      projects: {
        demo: {
          name: 'demo',
          root: 'packages/demo package'
        }
      }
    },
  }
  const read = async file => readFile(resolve(projectRoot, file), 'utf8')

  return {
    root,
    projectRoot,
    config,
    write,
    read,
    context,
    logs
  }
}
