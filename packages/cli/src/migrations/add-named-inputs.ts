import { defaultNamedInputs, readJson, writeJson } from '@isox-sh/core'

import type { MigrationContext } from '@isox-sh/core'

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

export default async function addNamedInputs({ workspaceRoot, logger }: MigrationContext): Promise<void> {
  const context = {
    projectRoot: workspaceRoot,
    logger
  }
  const settings = await readJson('isox.json', context)

  if (!isRecord(settings) || (settings.namedInputs !== undefined && !isRecord(settings.namedInputs))) {
    throw new Error('Invalid isox.json: expected a workspace object with an optional namedInputs object.')
  }

  const namedInputs = settings.namedInputs ?? {}

  if (Object.hasOwn(namedInputs, 'default')) {
    return
  }

  settings.namedInputs = {
    ...defaultNamedInputs(),
    ...namedInputs
  }
  await writeJson('isox.json', settings, context)
}
