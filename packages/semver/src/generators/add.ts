import { readJson, writeJson } from '@isox-sh/core'

import type { ProjectAdder } from '@isox-sh/core'

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

const add: ProjectAdder = async (_options, context) => {
  const project = await readJson('project.json', context)

  if (!isRecord(project) || (project.targets !== undefined && !isRecord(project.targets))) {
    throw new Error('Release setup requires a project.json object with an optional targets object.')
  }

  const targets = project.targets ?? {}

  if (Object.hasOwn(targets, 'version')) {
    const target = targets.version

    if (isRecord(target) && ['semver:version', '@isox-sh/semver:version'].includes(String(target.executor))) {
      context.logger.info(`Release version target already configured for ${context.projectName}.`)

      return
    }

    throw new Error(`Project ${context.projectName} already has a different version target. Rename it before adding release support.`)
  }

  await writeJson('project.json', {
    ...project,
    targets: {
      ...targets,
      version: { executor: 'semver:version' }
    }
  }, context)
}

export default add
