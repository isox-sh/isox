import { createRequire } from 'node:module'
import { resolve } from 'node:path'

export interface PlaywrightOptions {
  configFile?: string
  shard?: string
}

export function testArgs(options: PlaywrightOptions, workspaceRoot: string, projectRoot: string): string[] {
  const cli = createRequire(resolve(projectRoot, 'package.json')).resolve('@playwright/test/cli')
  const args = [cli, 'test']
  if (options.configFile !== undefined) {
    if (typeof options.configFile !== 'string' || !options.configFile.trim()) {
      throw new Error('Playwright configFile must be a non-empty string.')
    }

    args.push('--config', resolve(workspaceRoot, options.configFile))
  }

  return args
}

export function validateShard(shard: string): void {
  if (typeof shard !== 'string' || !/^[1-9]\d*\/[1-9]\d*$/.test(shard)) {
    throw new Error('Playwright shard must be current/total, for example 2/3.')
  }

  const [current, total] = shard.split('/').map(Number)
  if (!Number.isSafeInteger(total) || current > total) {
    throw new Error('Playwright shard index must be within the shard count.')
  }
}
