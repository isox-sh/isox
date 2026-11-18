import { AsyncLocalStorage } from 'node:async_hooks'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { aborted } from 'node:util'

import { parse } from 'dotenv'
import { expand } from 'dotenv-expand'

import type { ExecutorContext } from './types'

function readTaskVariables({ projectRoot, workspaceRoot, commandName, configurationName }: ExecutorContext) {
  const scopes = configurationName ? [`${commandName}.${configurationName}`, configurationName, commandName] : [commandName]
  const names = scopes.filter(scope => !scope.includes('/') && !scope.includes('\\')).flatMap(scope => [
    `.env.${scope}.local`, `.env.${scope}`, `.${scope}.local.env`, `.${scope}.env`
  ])
  names.push('.env.local', '.local.env', '.env')
  const env = { ...process.env } as Record<string, string>
  const key = (name: string) => process.platform === 'win32' ? name.toUpperCase() : name
  const spelling = new Map(Object.keys(env).map(name => [key(name), name]))
  const pending = new Map<string, string>()
  for (const root of new Set([projectRoot, workspaceRoot])) {
    for (const name of new Set(names)) {
      let contents: string

      try {
        contents = readFileSync(join(root, name), 'utf8')
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
          continue
        }

        throw error
      }

      for (const [variable, value] of Object.entries(parse(contents))) {
        const id = key(variable)
        if (!spelling.has(id)) {
          spelling.set(id, variable)
          pending.set(variable, value)
        }
      }
    }
  }

  const variables: Record<string, string> = Object.create(null)
  // Expand dependencies first, including forward references across files. A
  // reference back to a pending ancestor uses dotenv-expand's unset semantics.
  function resolveVariable(name: string) {
    const raw = pending.get(name)
    if (raw === undefined) {
      return
    }

    pending.delete(name)
    const value = raw.replace(/(?<!\\)\$(?:\{([\w.]+)|([A-Za-z_][A-Za-z0-9_]*))/g, (match, braced, bare) => {
      const actual = spelling.get(key(braced ?? bare))
      if (!actual) {
        return match
      }

      resolveVariable(actual)

      return (braced ? '${' : '$') + actual
    })
    expand({
      parsed: { [name]: value },
      processEnv: env
    })
    variables[name] = env[name]
  }

  for (const name of pending.keys()) {
    resolveVariable(name)
  }

  return variables
}

interface TaskScope {
  variables: Record<string, string>
  parent?: TaskScope
  closed?: boolean
  ready?: Promise<void>
}

const scopes = new AsyncLocalStorage<TaskScope>()
const rootScope: TaskScope = { variables: {} }

/** Serialize sibling calls sharing process.env. CLI workers use separate processes. */
export async function withTaskEnvironment(context: ExecutorContext, execute: () => Promise<void>): Promise<void> {
  let parent = scopes.getStore() ?? rootScope
  while (parent.closed && parent.parent) {
    parent = parent.parent
  }

  const previous = parent.ready
  const signal = context.signal
  const turn = previous && signal ? Promise.race([previous, aborted(signal, context)]) : previous
  const running = Promise.resolve(turn).then(async () => {
    if (previous && signal?.aborted) {
      return
    }

    const suspended: Record<string, string> = Object.create(null)
    const scope: TaskScope = {
      variables: {},
      parent
    }

    try {
      for (const [name, value] of Object.entries(parent.variables)) {
        if (process.env[name] === value) {
          suspended[name] = value
          delete process.env[name]
        }
      }

      scope.variables = readTaskVariables(context)
      Object.assign(process.env, scope.variables)
      await scopes.run(scope, execute)
    } finally {
      scope.closed = true
      // Promise.all may reject while an already-started sibling is still using the environment.
      await scope.ready
      for (const name of Object.keys(scope.variables)) {
        delete process.env[name]
      }

      Object.assign(process.env, suspended)
    }
  })

  // A cancelled waiter can return early, but its successor still waits for the current owner.
  const ready = Promise.allSettled([previous, running]).then(() => {
    if (parent.ready === ready) {
      parent.ready = undefined
    }
  })
  parent.ready = ready

  return running
}
