import type { TaskInput } from './configuration'

/** Fresh defaults shared by workspace initialization, migrations, and input resolution. */
export function defaultNamedInputs(): Record<string, TaskInput[]> {
  return { default: ['{projectRoot}/**/*'] }
}
