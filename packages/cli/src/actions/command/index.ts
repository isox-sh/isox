import { runProjectCommand } from '../../shared/run-project-command'

import type { CAC } from 'cac'

export function registerCommandAction(cli: CAC): void {
  cli
    .command('<command> <target>', 'Run a command on a project (e.g., build cli)')
    .option('--prod', 'Use the production configuration')
    .option('-c, --config, --configuration <name>', 'Use a named command configuration')
    .example('isox build cli')
    .action(runProjectCommand)
}
