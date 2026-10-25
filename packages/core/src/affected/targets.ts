import { resolveCommandOptions } from '../executor/configuration'

import type { WorkspaceGraph } from '../workspace/parser'
import type { TargetPlanOptions } from './types'

export function positiveInteger(value: number, label: string, maximum = 256): number {
  if (!Number.isSafeInteger(value) || value < 1 || value > maximum) {
    throw new Error(`${label} must be an integer between 1 and ${maximum}.`)
  }
  return value
}

export function validateName(value: string, label: string): void {
  if (typeof value !== 'string' || !/^[^\s:]+$/.test(value)) {
    throw new Error(`Invalid ${label}: expected a non-empty name without whitespace or colons.`)
  }
}

export function parseTarget(value: string): { target: string, config?: string } {
  const [target, config, extra] = value.split(':')
  validateName(target, 'target')
  if (extra !== undefined || (config !== undefined && !/^[^\s:,]+$/.test(config))) {
    throw new Error(`Invalid target ${value}. Use command or command:configuration.`)
  }
  return { target, config }
}

export function getCommandStages(options: TargetPlanOptions): { target: string, config?: string }[] {
  validateName(options.target, 'target')
  return [
    ...(options.preTargets ?? []).map(parseTarget),
    { target: options.target, config: options.config },
    ...(options.postTargets ?? []).map(parseTarget),
  ]
}

/** Validate every stage before workers start. Pre/post commands absent on a project are skipped. */
export function validateProjectCommands(workspace: WorkspaceGraph, projects: string[], options: TargetPlanOptions): void {
  const stages = getCommandStages(options)
  for (const project of projects) {
    if (!Object.hasOwn(workspace.projects, project)) {
      throw new Error(`Project ${project} not found in workspace.`)
    }

    const commands = workspace.projects[project].executors ?? {}
    for (const { target, config } of stages) {
      if (Object.hasOwn(commands, target)) {
        resolveCommandOptions(commands[target], project, target, config)
      } else if (target === options.target) {
        throw new Error(`Command ${target} not found in project ${project}.`)
      }
    }
  }
}
