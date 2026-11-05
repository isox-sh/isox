import { readJson } from '../utils/read-json'
import { writeJson } from '../utils/write-json'
import { readWorkspaceSettings } from './settings'

import type { InitializerContext } from '../initializer/types'
import type { ExecutorConfiguration, TargetDefaults } from './configuration'
import type { WorkspaceGraph } from './parser'
import type { WorkspaceSettings } from './settings'

function nxPackage(executor: string, settings: WorkspaceSettings): boolean {
  const pkg = typeof executor === 'string' ? executor.split(':')[0] : ''

  return (settings.nx?.executors ?? []).some(entry => entry === pkg
    || (entry.startsWith('@') && !entry.includes('/') && pkg.startsWith(`${entry}/`)))
}

/** Native executor shorthands and their scoped names share workspace defaults. */
function executorKeys(executor: string, settings: WorkspaceSettings): string[] {
  if (typeof executor !== 'string') {
    return []
  }

  const [pkg, name] = executor.split(':')
  const nx = nxPackage(executor, settings)
  const alias = nx ? undefined : pkg.startsWith('@isox-sh/')
    ? `${pkg.slice('@isox-sh/'.length)}:${name}`
    : !pkg.includes('/') && !pkg.startsWith('@') ? `@isox-sh/${executor}` : undefined

  return alias ? [alias, executor] : [executor]
}

/** Merge only the configuration containers; nested executor option values stay atomic. */
export function mergeTargetDefaults(base: TargetDefaults, override: TargetDefaults): TargetDefaults {
  const result = {
    ...base,
    ...override
  }

  if (base.options !== undefined || override.options !== undefined) {
    result.options = {
      ...base.options,
      ...override.options
    }
  }

  if (base.configurations !== undefined || override.configurations !== undefined) {
    const names = new Set([...Object.keys(base.configurations ?? {}), ...Object.keys(override.configurations ?? {})])

    result.configurations = Object.fromEntries([...names].map(name => [name, {
      ...(Object.hasOwn(base.configurations ?? {}, name) ? base.configurations![name] : {}),
      ...(Object.hasOwn(override.configurations ?? {}, name) ? override.configurations![name] : {}),
    }]))
  }

  return result
}

/** Resolve targets once during discovery, without mutating source definitions or settings. */
export function resolveTargetDefaults(workspace: WorkspaceGraph, settings: WorkspaceSettings): WorkspaceGraph {
  const defaults = settings.targetDefaults ?? {}

  return {
    projects: Object.assign(Object.create(null), Object.fromEntries(Object.entries(workspace.projects).map(([name, project]) => {
      if (!project.targets) {
        return [name, project]
      }

      const targets = Object.fromEntries(Object.entries(project.targets).map(([target, local]) => {
        let merged: TargetDefaults = Object.hasOwn(defaults, target) ? defaults[target] : {}

        for (const key of executorKeys(local.executor, settings)) {
          if (Object.hasOwn(defaults, key)) {
            merged = mergeTargetDefaults(merged, defaults[key])
          }
        }

        const command = mergeTargetDefaults(merged, local) as ExecutorConfiguration

        return [target, command]
      }))

      return [name, {
        ...project,
        targets
      }]
    })))
  }
}

/** Add missing plugin defaults while preserving deliberate false values and empty arrays. */
export async function addTargetDefaults(executor: string, defaults: TargetDefaults, context: InitializerContext): Promise<void> {
  const settings = await readWorkspaceSettings(context.workspaceRoot)
  const keys = executorKeys(executor, settings).reverse()
  const key = keys.find(key => Object.hasOwn(settings.targetDefaults ?? {}, key)) ?? executor
  const existing = settings.targetDefaults?.[key] ?? {}
  const additions = Object.fromEntries(Object.entries(defaults).filter(([name]) =>
    !keys.some(alias => Object.hasOwn(settings.targetDefaults?.[alias] ?? {}, name)),
  ))

  if (!Object.keys(additions).length) {
    return
  }

  // Preserve unrelated workspace fields, including the version and custom metadata.
  const workspaceContext = {
    ...context,
    projectRoot: context.workspaceRoot
  }
  let contents: Record<string, unknown>

  try {
    contents = await readJson<Record<string, unknown>>('isox.json', workspaceContext)
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
      throw error
    }

    contents = {}
  }

  await writeJson('isox.json', {
    ...contents,
    targetDefaults: {
      ...settings.targetDefaults,
      [key]: {
        ...additions,
        ...existing
      },
    },
  }, workspaceContext)
}
