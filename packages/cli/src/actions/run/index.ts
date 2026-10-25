import { runProjectCommand } from '../../shared/run-project-command'

import type { ConfigurationOptions } from '../../shared/options'
import type { CAC } from 'cac'

export function registerRunAction(cli: CAC): void {
  cli
    .command('run <target>', 'Run a project command (e.g., my-app:build)')
    .option('--prod', 'Use the production configuration')
    .option('-c, --config, --configuration <name>', 'Use a named command configuration')
    .action(async (targetStr: string, options: ConfigurationOptions) => {
      if (!/^[^:]+:[^:]+$/.test(targetStr)) {
        throw new Error('Invalid target format. Use project:target')
      }

      const [projectName, targetName] = targetStr.split(':')
      await runProjectCommand(targetName, projectName, options)
    })
}
