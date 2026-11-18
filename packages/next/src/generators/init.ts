import { mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'

import { addDepsToPackageJson, addTargetDefaults, writeJson } from '@isox-sh/core'

import type { ProjectInitializer } from '@isox-sh/core'

const nextConfig = `import constants from 'next/constants.js'

export default phase => ({
  distDir: phase === constants.PHASE_DEVELOPMENT_SERVER ? '.next-dev' : '.next',
})
`

const layout = `export default function RootLayout({ children }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  )
}
`

const init: ProjectInitializer = async (_options, context) => {
  const { projectName, projectRoot, workspaceRoot } = context
  const plugin = JSON.parse(await readFile(join(__dirname, '../package.json'), 'utf8'))
  const page = `export default function Home() {
  return <main><h1>{${JSON.stringify(projectName)}}</h1></main>
}
`

  await mkdir(dirname(projectRoot), { recursive: true })
  await mkdir(projectRoot)

  try {
    await mkdir(join(projectRoot, 'app'))
    await writeFile(join(projectRoot, 'app/layout.jsx'), layout, { flag: 'wx' })
    await writeFile(join(projectRoot, 'app/page.jsx'), page, { flag: 'wx' })
    await writeFile(join(projectRoot, 'next.config.mjs'), nextConfig, { flag: 'wx' })
    await writeFile(join(projectRoot, '.gitignore'), '/.next/\n/.next-dev/\n/out/\n', { flag: 'wx' })
    await writeJson('project.json', {
      name: projectName,
      targets: {
        build: { executor: 'next:build' },
        serve: {
          executor: 'next:serve',
          configurations: {
            production: { mode: 'production' }
          }
        }
      }
    }, context, { overwrite: false })

    await addDepsToPackageJson({
      dependencies: {
        next: '^16.4.6',
        react: '^19.2.0',
        'react-dom': '^19.2.0'
      },
      devDependencies: { '@isox-sh/next': plugin.version }
    }, {
      ...context,
      projectRoot: workspaceRoot
    })
  } catch (error) {
    await rm(projectRoot, {
      recursive: true,
      force: true
    })
    throw error
  }

  await addTargetDefaults('next:build', {
    cache: true,
    inputs: ['default', '!{projectRoot}/.next-dev', { envPrefix: 'NEXT_PUBLIC_' }],
    outputs: ['{projectRoot}/.next']
  }, context)
}

export default init
