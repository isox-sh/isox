import { existsSync, readFileSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'

import { Ajv } from 'ajv'

export interface WorkspaceSettings {
  nx?: {
    executors?: string[]
  }
}

const ajv = new Ajv({ allErrors: true })
const schema = JSON.parse(readFileSync([join(__dirname, '../schemas/isox.schema.json'), join(__dirname, '../../schemas/isox.schema.json')]
  .find(path => existsSync(path))!, 'utf8'))
const isWorkspaceSettings = ajv.compile<WorkspaceSettings>(schema)

export async function readWorkspaceSettings(root: string): Promise<WorkspaceSettings> {
  const file = join(root, 'isox.json')
  let source: string
  try {
    source = await readFile(file, 'utf8')
  } catch (error) {
    // The core API also supports workspaces without a CLI root marker.
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      return {}
    }
    throw error
  }

  let settings: unknown
  try {
    settings = JSON.parse(source)
  } catch (error) {
    throw new Error(`Invalid workspace configuration in ${file}: invalid JSON.`, { cause: error })
  }

  if (!isWorkspaceSettings(settings)) {
    throw new Error(`Invalid workspace configuration in ${file}: ${ajv.errorsText(isWorkspaceSettings.errors, { dataVar: 'workspace' })}`)
  }

  return settings
}
