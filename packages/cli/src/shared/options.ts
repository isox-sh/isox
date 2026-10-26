import { positiveInteger } from '@isox-sh/core'

import type { TargetPlanOptions } from '@isox-sh/core'
import type { CAC } from 'cac'

export interface SelectionOptions {
  base?: string
  head?: string
  all?: boolean
  uncommitted?: boolean
  untracked?: boolean
}

export interface ConfigurationOptions {
  skipCache?: boolean
  configuration?: string | number
  prod?: boolean
}

export interface TargetOptions extends ConfigurationOptions {
  target?: string
  tag?: string
  maxJobs?: string | number
  parallel?: string | number
  preTargets?: string
  postTargets?: string
  preTargetsJson?: string
  postTargetsJson?: string
}

type Command = ReturnType<CAC['command']>

export function selectionOptions(command: Command): Command {
  return command
    .option('--base <ref>', 'Compare from this merge base (default: ISOX_BASE, affected.defaultBase, or origin/main)')
    .option('--head <ref>', 'Compare committed changes up to this ref (default: ISOX_HEAD or HEAD)')
    .option('--uncommitted', 'Also include staged and unstaged changes')
    .option('--untracked', 'Also include untracked, non-ignored files')
    .option('--all', 'Select all projects without consulting Git')
}

export function targetOptions(command: Command): Command {
  return command
    .option('-t, --target <command>', 'Project command to run')
    .option('--tag <expression>', 'Tag filter: comma-separated AND conditions, newline-separated OR groups')
    .option('--parallel <count>', 'Maximum concurrent projects in this worker (default: 1)')
    .option('-c, --config, --configuration <name>', 'Use a named command configuration')
    .option('--prod', 'Use the production configuration')
    .option('--pre-targets <commands>', 'Commands to run before the target, separated by commas or newlines')
    .option('--post-targets <commands>', 'Commands to run after the target, separated by commas or newlines')
    .option('--pre-targets-json <json>', 'Exact JSON array of commands to run before the target')
    .option('--post-targets-json <json>', 'Exact JSON array of commands to run after the target')
}

export function stringList(value: string): string[] {
  return value.split(/[,\r\n]/).map(part => part.trim()).filter(Boolean)
}

export function jsonValue(value: string, label: string): unknown {
  try {
    return JSON.parse(value)
  } catch {
    throw new Error(`${label} must contain valid JSON.`)
  }
}

export function projectList(value: unknown): string[] {
  if (!Array.isArray(value) || value.some(name => typeof name !== 'string' || !/^[^\s:]+$/.test(name))) {
    throw new Error('Projects must be a JSON array of project names.')
  }

  if (new Set(value).size !== value.length) {
    throw new Error('Projects must not contain duplicates.')
  }

  return value
}

export function configurationName(options: ConfigurationOptions): string | undefined {
  const selected = options.configuration

  if (selected !== undefined && typeof selected !== 'string' && typeof selected !== 'number') {
    throw new Error('Specify exactly one configuration name with --config.')
  }

  return selected !== undefined ? String(selected) : options.prod ? 'production' : undefined
}

function commandList(value: unknown, label: string): string[] {
  if (!Array.isArray(value) || value.some(entry => typeof entry !== 'string')) {
    throw new Error(`${label} must be an array of commands.`)
  }

  return value
}

function stageOptions(value: string | undefined, encoded: string | undefined, flag: string): string[] {
  if (value !== undefined && encoded !== undefined) {
    throw new Error(`Use either ${flag} or ${flag}-json.`)
  }

  if (encoded !== undefined) {
    return commandList(jsonValue(encoded, `${flag}-json`), `${flag}-json`)
  }

  return value === undefined ? [] : stringList(value)
}

export function targetPlan(options: TargetOptions): TargetPlanOptions {
  if (typeof options.target !== 'string' || !options.target) {
    throw new Error('Specify a project command with --target.')
  }

  return {
    target: options.target,
    tag: options.tag,
    maxJobs: positiveInteger(Number(options.maxJobs ?? 1), 'maxJobs'),
    parallel: positiveInteger(Number(options.parallel ?? 1), 'parallel'),
    config: configurationName(options),
    preTargets: stageOptions(options.preTargets, options.preTargetsJson, '--pre-targets'),
    postTargets: stageOptions(options.postTargets, options.postTargetsJson, '--post-targets'),
  }
}

/** Strictly validate JSON options so a misspelling cannot silently change a CI plan. */
export function targetPlans(value: unknown): TargetPlanOptions[] {
  if (!Array.isArray(value) || !value.length) {
    throw new Error('Targets must be a non-empty JSON array of target settings.')
  }

  const keys = ['target', 'tag', 'maxJobs', 'parallel', 'config', 'preTargets', 'postTargets']
  const names = new Set<string>()

  return value.map(item => {
    if (!item || typeof item !== 'object' || Array.isArray(item) || Object.keys(item).some(key => !keys.includes(key))) {
      throw new Error(`Target settings support only: ${keys.join(', ')}.`)
    }

    for (const field of ['target', 'tag', 'config']) {
      if ((field === 'target' || item[field] !== undefined) && typeof item[field] !== 'string') {
        throw new Error(`Target ${field} must be a string.`)
      }
    }

    for (const field of ['maxJobs', 'parallel']) {
      if (item[field] !== undefined) {
        positiveInteger(item[field], field)
      }
    }

    for (const field of ['preTargets', 'postTargets']) {
      if (item[field] !== undefined) {
        commandList(item[field], field)
      }
    }

    if (names.has(item.target)) {
      throw new Error(`Duplicate target ${item.target}. Create separate plans for different filters or configurations.`)
    }

    names.add(item.target)

    return item as TargetPlanOptions
  })
}
