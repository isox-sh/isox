interface TagCondition {
  tag: string
  exclude: boolean
}

function parseCondition(value: string): TagCondition {
  const condition = value.trim()

  if (!condition) {
    throw new Error('Tag filters must not contain empty comma-separated conditions.')
  }

  const equalsIndex = condition.indexOf('=')
  const operator = equalsIndex > 0 && condition[equalsIndex - 1] === '!' ? '!=' : '='
  const index = condition.indexOf(operator)

  if (index < 0) {
    return {
      tag: condition,
      exclude: false
    }
  }

  const key = condition.slice(0, index).trim()
  const expected = condition.slice(index + operator.length).trim()

  if (!key || !expected) {
    throw new Error(`Invalid tag condition ${condition}.`)
  }

  return {
    tag: `${key}=${expected}`,
    exclude: operator === '!='
  }
}

/** Parse once per selection. Newlines are OR groups; commas are AND conditions. */
export function createTagFilter(expression = ''): (tags: string[]) => boolean {
  const groups = expression.split(/\r?\n/)
    .map(group => group.trim())
    .filter(Boolean)
    .map(group => group.split(',').map(parseCondition))

  return tags => groups.length === 0 || groups.some(group => group.every(condition => {
    const present = tags.includes(condition.tag)

    return condition.exclude ? !present : present
  }))
}

export function matchesTags(tags: string[], expression = ''): boolean {
  return createTagFilter(expression)(tags)
}
