import { existsSync } from 'node:fs'
import { join } from 'node:path'

export function workspaceSchemaPath(name: string): string {
  const candidates = [join(__dirname, '../schemas', name), join(__dirname, '../../schemas', name)]
  const path = candidates.find(candidate => existsSync(candidate))
  if (!path) {
    throw new Error(`Missing workspace schema ${name}. Rebuild or reinstall @isox-sh/core.`)
  }
  return path
}
