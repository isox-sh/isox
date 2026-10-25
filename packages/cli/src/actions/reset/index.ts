import { logger, resetWorkspace } from '@isox-sh/core'

import type { CAC } from 'cac'

export function registerResetAction(cli: CAC): void {
  cli
    .command('reset', 'Remove the workspace cache; the next run rebuilds it')
    .action(async () => {
      await resetWorkspace()

      logger.success('Workspace cache cleared. The next run will rebuild it.')
    })
}
