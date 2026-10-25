import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'

import { Ajv } from 'ajv'

import { isNxProjectSchema, migrateNxProject } from './nx'

export interface ExecutorConfiguration {
  [key: string]: unknown
  executor: string
  options?: Record<string, unknown>
  configurations?: Record<string, Record<string, unknown>>
  defaultConfiguration?: string
}

/** The contents of an Isox project.json, before its name and root are resolved. */
export interface ProjectDefinition {
  [key: string]: unknown
  $schema?: string
  name?: string
  dependencies?: string[]
  executors?: Record<string, ExecutorConfiguration>
  tags?: string[]
}

const ajv = new Ajv({ allErrors: true })
const schemaPath = [join(__dirname, '../schemas/project.schema.json'), join(__dirname, '../../schemas/project.schema.json')]
  .find(path => existsSync(path))!
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
