import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

import { Ajv } from 'ajv'

import type { PackageJsonOptions } from '../../helpers/package-json'

export interface AssetPattern {
  input: string
  glob: string
  output?: string
  ignore?: string[]
}

export interface TscOptions extends Omit<PackageJsonOptions, 'sourceFiles'> {
  tsConfig?: string
  clean?: boolean
  assets?: AssetPattern[]
  generatePackageJson?: boolean
  watch?: boolean
  pollInterval?: number
}

const ajv = new Ajv({ allErrors: true })
const validate = ajv.compile<TscOptions>(JSON.parse(readFileSync(resolve(__dirname, 'tsc.schema.json'), 'utf8')))

export function validateOptions(options: unknown): asserts options is TscOptions {
  if (!validate(options)) {
    throw new Error(`Invalid tsc options: ${ajv.errorsText(validate.errors, { dataVar: 'options' })}. Compiler settings belong in tsconfig.json; migrate unsupported Nx options explicitly.`)
  }

  if ((options.generateExportsField || options.additionalEntryPoints) && !options.generatePackageJson) {
    throw new Error('generateExportsField and additionalEntryPoints require generatePackageJson: true.')
  }

  if (options.additionalEntryPoints && !options.generateExportsField) {
    throw new Error('additionalEntryPoints requires generateExportsField: true.')
  }
}
