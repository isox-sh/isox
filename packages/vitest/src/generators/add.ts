import { addTargetDefaults, readJson, writeJson } from '@isox-sh/core'

import type { ProjectAdder, ProjectDefinition } from '@isox-sh/core'

const add: ProjectAdder = async (_options, context) => {
  const project = await readJson<ProjectDefinition>('project.json', context)

  if (!project || typeof project !== 'object' || Array.isArray(project)
    || (project.targets !== undefined && (!project.targets || typeof project.targets !== 'object' || Array.isArray(project.targets)))) {
    throw new Error('Vitest setup requires a project.json object with an optional targets object.')
  }

  const target = Object.hasOwn(project.targets ?? {}, 'test') ? project.targets!.test : undefined

  if (target !== undefined && !['vitest:test', '@isox-sh/vitest:test'].includes(target?.executor)) {
    throw new Error(`Project ${context.projectName} already has a different test target. Rename it before adding Vitest.`)
  }

  await addTargetDefaults('vitest:test', {
    cache: true
  }, context)

  if (target !== undefined) {
    context.logger.info(`Vitest test target already configured for ${context.projectName}.`)

    return
  }

  await writeJson('project.json', {
    ...project,
    targets: {
      ...project.targets,
      test: { executor: 'vitest:test' }
    }
  }, context)
}

export default add
