/** Serialize a value as JSON with two-space indentation and a trailing newline. */
export function json(value: unknown): string {
  const source = JSON.stringify(value, null, 2)
  if (source === undefined) {
    throw new TypeError('Cannot serialize value as JSON.')
  }

  return `${source}\n`
}
