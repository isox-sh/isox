import { readJson, writeJson } from '@isox-sh/core'

import { setupWorkspace } from './workspace'

import type { ProjectAdder, ProjectDefinition } from '@isox-sh/core'

const add: ProjectAdder = async (_options, context) => {
  const project = await readJson<ProjectDefinition>('project.json', context)

  if (!project || typeof project !== 'object' || Array.isArray(project)
    || (project.targets !== undefined && (!project.targets || typeof project.targets !== 'object' || Array.isArray(project.targets)))) {
    throw new Error('ESLint setup requires a project.json object with an optional targets object.')
  }

  const target = Object.hasOwn(project.targets ?? {}, 'lint') ? project.targets!.lint : undefined

  if (target !== undefined && !['eslint:lint', '@isox-sh/eslint:lint'].includes(target?.executor)) {
    throw new Error(`Project ${context.projectName} already has a different lint target. Rename it before adding ESLint.`)
  }

  await setupWorkspace(context)

  if (target !== undefined) {
    context.logger.info(`ESLint lint target already configured for ${context.projectName}.`)

    return
  }

  await writeJson('project.json', {
    ...project,
    targets: {
      ...project.targets,
      lint: { executor: 'eslint:lint' }
    }
  }, context)
}

export default add
