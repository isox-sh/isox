import { findWorkspaceRoot, planMigrations, runMigrations } from '@isox-sh/core'

import type { CAC } from 'cac'

interface MigrateOptions {
  runMigrations?: string | boolean
  ifExists?: boolean
}

export function registerMigrateAction(cli: CAC): void {
  cli.command('migrate [version]', 'Update Isox dependencies and plan or run migrations')
    .option('--run-migrations [file]', 'Run a reviewed migration plan (default: migrations.json)')
    .option('--if-exists', 'Skip running migrations when the plan does not exist')
    .example('isox migrate latest')
    .example('isox migrate --run-migrations')
    .action(async (target: string | undefined, options: MigrateOptions) => {
      if (options.runMigrations !== undefined) {
        if (target || (typeof options.runMigrations !== 'string' && options.runMigrations !== true)) {
          throw new Error('Use either migrate <version|latest> or migrate --run-migrations [file].')
        }

        await runMigrations(await findWorkspaceRoot(), typeof options.runMigrations === 'string' ? options.runMigrations : undefined, options.ifExists)
      } else {
        if (!target || options.ifExists) {
          throw new Error('Use migrate <version|latest>; --if-exists requires --run-migrations.')
        }

        await planMigrations(await findWorkspaceRoot(), target)
      }
    })
}
