#!/usr/bin/env node
import { logger, LogLevels } from '@isox-sh/core'
import { cac } from 'cac'

import { registerCommandAction } from './actions/command'
import { registerInitAction } from './actions/init'
import { registerResetAction } from './actions/reset'
import { registerRunAction } from './actions/run'

const cli = cac('isox')
cli.option('--verbose', 'Show debug logs and error stack traces')

registerCommandAction(cli)
registerInitAction(cli)
registerRunAction(cli)
registerResetAction(cli)

cli.help()

async function main(): Promise<void> {
  cli.parse(process.argv, { run: false })
  logger.level = cli.options.verbose ? LogLevels.debug : LogLevels.info
  if (process.argv.length === 2) {
    cli.outputHelp()
    return
  }

  await cli.runMatchedCommand()
}

main().catch((error: unknown) => {
  logger.error(logger.level >= LogLevels.debug
    ? error
    : error instanceof Error ? error.message : String(error))
  process.exitCode = 1
})
