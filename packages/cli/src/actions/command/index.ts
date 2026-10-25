import { executionOptions, getExecutorOverrides } from '../../shared/executor-options'
import { runProjectCommand } from '../../shared/run-project-command'

import type { ConfigurationOptions } from '../../shared/options'
import type { CAC } from 'cac'

export function registerCommandAction(cli: CAC): void {
  executionOptions(cli.command('<command> <target>', 'Run a command on a project (e.g., build cli)'))
    .option('--prod', 'Use the production configuration')
    .option('-c, --config, --configuration <name>', 'Use a named command configuration')
    .example('isox build cli')
    .action((command: string, project: string, options: ConfigurationOptions) =>
      runProjectCommand(command, project, options, getExecutorOverrides(cli))
    )
}
