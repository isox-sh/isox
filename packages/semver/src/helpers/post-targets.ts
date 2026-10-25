import { resolveCommandOptions, runExecutor } from '@isox-sh/core'

import type { PostTarget } from '../executors/version/options'
import type { ExecutorContext } from '@isox-sh/core'

export interface ReleaseValues {
  projectName: string
  version: string
  tag: string
  previousTag: string
  preid: string
  npmTag: string
  prerelease: boolean
  notes: string
  dryRun: boolean
}

interface PreparedTarget {
  project: string
  target: string
  configuration?: string
  options: Record<string, unknown>
}

/** Substitute values, not shell commands. Exact placeholders retain their original types. */
function interpolate(value: unknown, values: ReleaseValues): unknown {
  if (typeof value === 'string') {
    const exact = /^\{(projectName|version|tag|previousTag|preid|npmTag|prerelease|notes|dryRun)\}$/.exec(value)

    if (exact) {
      return values[exact[1] as keyof ReleaseValues]
    }

    return value.replace(/\{(projectName|version|tag|previousTag|preid|npmTag|prerelease|notes|dryRun)\}/g,
      (_, name: keyof ReleaseValues) => String(values[name]))
  }

  if (Array.isArray(value)) {
    return value.map(item => interpolate(item, values))
  }

  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, interpolate(item, values)]))
  }

  return value
}

export function preparePostTargets(entries: (string | PostTarget)[], context: ExecutorContext, values: ReleaseValues): PreparedTarget[] {
  return entries.map(entry => {
    const specification = typeof entry === 'string' ? { target: entry } : entry
    const parts = specification.target.split(':')
    const [projectName, targetName, configuration] = parts.length === 1 ? [context.projectName, parts[0]] : parts
    const project = Object.hasOwn(context.workspace.projects, projectName) ? context.workspace.projects[projectName] : undefined
    const target = project?.targets && Object.hasOwn(project.targets, targetName) ? project.targets[targetName] : undefined

    if (!target || parts.length > 3 || parts.some(part => !part.trim())) {
      throw new Error(`Invalid release post target: ${specification.target}`)
    }

    if ((projectName === context.projectName && targetName === context.commandName)
      || ['semver:version', '@isox-sh/semver:version'].includes(target.executor)) {
      throw new Error('A release post target cannot start another version release.')
    }

    const resolved = resolveCommandOptions(target, projectName, targetName, configuration)
    const options = interpolate({
      ...resolved.options,
      ...specification.options
    }, values) as Record<string, unknown>

    return {
      project: projectName,
      target: targetName,
      configuration: resolved.configurationName,
      options
    }
  })
}

export async function runPostTargets(targets: PreparedTarget[], context: ExecutorContext): Promise<void> {
  for (const target of targets) {
    context.signal?.throwIfAborted()
    await runExecutor(context.workspace, target.project, target.target, context.workspaceRoot, context.logger, target.configuration, context.signal, target.options)
  }
}
