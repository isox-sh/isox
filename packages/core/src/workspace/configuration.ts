import { readFileSync } from 'node:fs'
import { pathToFileURL } from 'node:url'

import { Ajv } from 'ajv'

import { isNxProjectSchema, migrateNxProject } from './nx'
import { workspaceSchemaPath } from './schema'

interface ProjectPlan {
  [key: string]: unknown
  /** Include this project in automatic selection. Defaults to true. */
  enabled?: boolean
  /** Relative CI cost. Defaults to 1 and must be positive. */
  weight?: number
}

export interface EnvironmentInput {
  env: string
}

export type TaskInput = string | EnvironmentInput

export interface TargetDefaults {
  [key: string]: unknown
  options?: Record<string, unknown>
  configurations?: Record<string, Record<string, unknown>>
  defaultConfiguration?: string
  /** Opt in only for deterministic, side-effect-free tasks. */
  cache?: boolean
  inputs?: TaskInput[]
  /** Exclusive, disposable output directories. Omit for logs only; [] clears inherited outputs. */
  outputs?: string[]
}

export interface ExecutorConfiguration extends TargetDefaults {
  executor: string
}

/** The contents of an Isox project.json, before its name and root are resolved. */
export interface ProjectDefinition {
  [key: string]: unknown
  $schema?: string
  name?: string
  /** Additional project names, merged with inferred dependencies when analysis is requested. */
  dependencies?: string[]
  targets?: Record<string, ExecutorConfiguration>
  tags?: string[]
  plan?: ProjectPlan
}

const ajv = new Ajv({ allErrors: true })
const schemaPath = workspaceSchemaPath('project.schema.json')
const schema = JSON.parse(readFileSync(schemaPath, 'utf8'))

export const isProjectDefinition = ajv.compile<ProjectDefinition>(schema)

export function parseProjectDefinition(content: unknown, file: string): ProjectDefinition {
  if (content !== null && typeof content === 'object' && !Array.isArray(content)
    && isNxProjectSchema((content as Record<string, unknown>).$schema)) {
    content = migrateNxProject(content as Record<string, unknown>, file, pathToFileURL(schemaPath).href)
  }

  if (!isProjectDefinition(content)) {
    throw new Error(`Invalid project configuration in ${file}: ${ajv.errorsText(isProjectDefinition.errors, { dataVar: 'project' })}`)
  }

  return content
}
