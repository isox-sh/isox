import { mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { dirname, join, relative, sep } from 'node:path'

import { addDepsToPackageJson, writeJson } from '@isox-sh/core'

import type { ProjectInitializer } from '@isox-sh/core'

const init: ProjectInitializer = async (_options, context) => {
  const { projectName, projectRoot } = context

  const baseConfig = relative(projectRoot, join(context.workspaceRoot, 'tsconfig.base.json')).split(sep).join('/')
  const rspackConfig = `import { existsSync } from 'node:fs'
import { resolve } from 'node:path'

const workspaceConfig = resolve(import.meta.dirname, ${JSON.stringify(baseConfig)})

export default {
  entry: './src/index.js',
  resolve: {
    tsConfig: existsSync(workspaceConfig) ? workspaceConfig : undefined,
    extensions: ['...', '.ts', '.mts', '.cts'],
    extensionAlias: {
      '.js': ['.js', '.ts'],
      '.mjs': ['.mjs', '.mts'],
      '.cjs': ['.cjs', '.cts'],
    },
  },
  module: {
    rules: [{
      test: /\\.[cm]?ts$/,
      loader: 'builtin:swc-loader',
      options: { detectSyntax: 'auto' },
    }],
  },
}
`

  await mkdir(dirname(projectRoot), { recursive: true })
  await mkdir(projectRoot)

  try {
    await mkdir(join(projectRoot, 'src'))
    await writeFile(join(projectRoot, 'src/index.js'), `console.log(${JSON.stringify(projectName)})\n`, { flag: 'wx' })
    await writeFile(join(projectRoot, 'rspack.config.mjs'), rspackConfig, { flag: 'wx' })
    await writeJson('project.json', {
      name: projectName,
      targets: {
        build: {
          executor: 'rspack:build',
          cache: true,
          outputs: ['{projectRoot}/dist']
        },
        serve: { executor: 'rspack:serve' }
      }
    }, context, { overwrite: false })

    const plugin = JSON.parse(await readFile(join(__dirname, '../package.json'), 'utf8'))

    await addDepsToPackageJson({
      devDependencies: {
        '@isox-sh/rspack': plugin.version,
        '@rspack/core': plugin.dependencies['@rspack/core'],
        '@rspack/cli': plugin.dependencies['@rspack/cli'],
        '@rspack/dev-server': plugin.dependencies['@rspack/dev-server'],
      }
    }, {
      ...context,
      projectRoot: context.workspaceRoot
    })
  } catch (error) {
    await rm(projectRoot, {
      recursive: true,
      force: true
    })
    throw error
  }
}

export default init
