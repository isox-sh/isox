import { readFile } from 'node:fs/promises'
import { join } from 'node:path'

import { addDepsToPackageJson, readJson, writeJson } from '@isox-sh/core'

import type { ProjectAdder, ProjectDefinition } from '@isox-sh/core'

const add: ProjectAdder = async (_options, context) => {
  const project = await readJson<ProjectDefinition>('project.json', context)

  if (!project || typeof project !== 'object' || Array.isArray(project)
    || (project.targets !== undefined && (!project.targets || typeof project.targets !== 'object' || Array.isArray(project.targets)))) {
    throw new Error('Playwright setup requires a project.json object with an optional targets object.')
  }

  const target = Object.hasOwn(project.targets ?? {}, 'e2e') ? project.targets!.e2e : undefined

  if (target !== undefined && !['playwright:test', '@isox-sh/playwright:test'].includes(target?.executor)) {
    throw new Error(`Project ${context.projectName} already has a different e2e target. Rename it before adding Playwright.`)
  }

  const plugin = JSON.parse(await readFile(join(__dirname, '../package.json'), 'utf8'))

  await addDepsToPackageJson({
    devDependencies: {
      '@isox-sh/playwright': plugin.version,
      '@playwright/test': plugin.peerDependencies['@playwright/test']
    }
  }, {
    ...context,
    projectRoot: context.workspaceRoot
  })

  if (target !== undefined) {
    context.logger.info(`Playwright e2e target already configured for ${context.projectName}.`)

    return
  }

  await writeJson('project.json', {
    ...project,
    targets: {
      ...project.targets,
      e2e: {
        executor: 'playwright:test',
        planner: { shards: 'auto' }
      }
    }
  }, context)
}

export default add
