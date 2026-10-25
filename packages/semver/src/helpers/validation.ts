import { readFileSync } from 'node:fs'

import { Ajv } from 'ajv'

/** Runtime checks use the same schema that editors expose to project.json authors. */
export function optionsValidator<T>(schemaPath: string, name: string): (options: unknown) => asserts options is T {
  const ajv = new Ajv({ allErrors: true })
  const validate = ajv.compile<T>(JSON.parse(readFileSync(schemaPath, 'utf8')))

  return (options: unknown): asserts options is T => {
    if (!validate(options)) {
      throw new Error(`Invalid ${name} options: ${ajv.errorsText(validate.errors, { dataVar: 'options' })}`)
    }
  }
}
