#!/usr/bin/env node
import { logger, LogLevels } from '@isox-sh/core'
import { cac } from 'cac'

import { registerAffectedAction } from './actions/affected'
import { registerCommandAction } from './actions/command'
import { registerInitAction } from './actions/init'
import { registerPlanAction } from './actions/plan'
import { registerResetAction } from './actions/reset'
import { registerRunAction } from './actions/run'
import { registerRunManyAction } from './actions/run-many'
import { preserveOptionValues } from './shared/parse-options'

const cli = cac('isox')
cli.option('--verbose', 'Show debug logs and error stack traces')

registerCommandAction(cli)
registerInitAction(cli)
registerRunAction(cli)
registerResetAction(cli)
registerAffectedAction(cli)
registerPlanAction(cli)
registerRunManyAction(cli)

cli.help()

async function main(): Promise<void> {
  cli.parse(process.argv, { run: false })
  preserveOptionValues(cli)
  // CAC keeps tokens after -- separately; our commands use them as literal positional names.
  cli.args = [...cli.args, ...cli.options['--']]
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
