import { randomUUID } from 'node:crypto'
import { lstat, readFile, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'

import { addDepsToPackageJson, publishNewFile, readJson } from '@isox-sh/core'

import type { InitializerContext } from '@isox-sh/core'

const flatConfigs = ['js', 'mjs', 'cjs', 'ts', 'mts', 'cts'].map(extension => `eslint.config.${extension}`)
const legacyConfigs = ['.eslintrc', '.eslintrc.js', '.eslintrc.cjs', '.eslintrc.json', '.eslintrc.yaml', '.eslintrc.yml']
const config = `import js from '@eslint/js'
import { defineConfig, globalIgnores } from 'eslint/config'
import globals from 'globals'
import tseslint from 'typescript-eslint'

export default defineConfig(
  globalIgnores(['**/dist/**', '**/build/**', '**/coverage/**', '**/.isox/**']),
  {
    files: ['**/*.{js,cjs,mjs,jsx,ts,cts,mts,tsx}'],
    extends: [js.configs.recommended, tseslint.configs.recommended],
    languageOptions: { globals: globals.node },
  },
)
`

async function exists(file: string): Promise<boolean> {
  try {
    await lstat(file)

    return true
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
      throw error
    }

    return false
  }
}

export async function setupWorkspace(context: InitializerContext): Promise<void> {
  const rootContext = {
    ...context,
    projectRoot: context.workspaceRoot
  }
  let hasConfig = false

  for (const name of [...flatConfigs, ...legacyConfigs]) {
    if (await exists(join(context.workspaceRoot, name))) {
      hasConfig = true

      if (legacyConfigs.includes(name)) {
        context.logger.warn(`Preserving ${name}. ESLint 10 requires a flat config; migrate it before linting.`)
      }

      break
    }
  }

  const manifest = await readJson<Record<string, unknown>>('package.json', rootContext).catch(error => {
    if (error.code !== 'ENOENT') {
      throw error
    }

    return {}
  })

  if (!hasConfig && Object.hasOwn(manifest ?? {}, 'eslintConfig')) {
    hasConfig = true
    context.logger.warn('Preserving package.json eslintConfig. ESLint 10 requires a flat config; migrate it before linting.')
  }

  const plugin = JSON.parse(await readFile(join(__dirname, '../package.json'), 'utf8'))

  await addDepsToPackageJson({
    devDependencies: {
      '@isox-sh/eslint': plugin.version,
      eslint: plugin.dependencies.eslint,
      ...(!hasConfig ? {
        '@eslint/js': '^10.0.1',
        'globals': '^17.13.0',
        'typescript': '~6.0.3',
        'typescript-eslint': '^8.72.0',
      } : {}),
    }
  }, rootContext)

  if (!hasConfig) {
    const destination = join(context.workspaceRoot, 'eslint.config.mjs')
    const temporary = `${destination}.${randomUUID()}.tmp`

    try {
      await writeFile(temporary, config, { flag: 'wx' })
      await publishNewFile(temporary, destination)
      context.logger.success('Created file eslint.config.mjs')
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'EEXIST') {
        throw error
      }
    } finally {
      await rm(temporary, { force: true })
    }
  }

  context.logger.info('ESLint dependencies are declared in the root package.json. Run your package manager install before linting.')
}
