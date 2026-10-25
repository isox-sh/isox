import { readFileSync } from 'node:fs'

import { resolvePlanRange } from '../shared/git.mjs'
import { actionMain, booleanInput, captureCli, cliContext, input, readJson, setOutput, summary } from '../shared/runtime.mjs'

export function planTargets(targets, settings = {}) {
  const names = targets.split(/[\r\n,]/).map(name => name.trim()).filter(Boolean)
  if (!names.length || !settings || typeof settings !== 'object' || Array.isArray(settings)) {
    throw new Error('Provide targets and a targetOptions JSON object keyed by target name.')
  }
  for (const name of Object.keys(settings)) {
    if (!names.includes(name)) {
      throw new Error(`targetOptions contains unrequested target ${name}.`)
    }
  }
  return names.map(target => {
    const options = Object.hasOwn(settings, target) ? settings[target] : {}
    if (!options || typeof options !== 'object' || Array.isArray(options) || Object.hasOwn(options, 'target')) {
      throw new Error(`targetOptions.${target} must be an options object without a target field.`)
    }
    return { ...options, target }
  })
}

export async function main() {
  const context = cliContext()
  const targets = planTargets(input('targets'), readJson(input('targetOptions', '{}'), 'targetOptions'))
  const event = process.env.GITHUB_EVENT_PATH ? readJson(readFileSync(process.env.GITHUB_EVENT_PATH, 'utf8'), 'GitHub event') : {}
  const { base, head } = resolvePlanRange(context, {
    base: input('base', process.env.ISOX_BASE),
    head: input('head', process.env.ISOX_HEAD),
    sha: process.env.GITHUB_SHA,
    eventName: process.env.GITHUB_EVENT_NAME,
    event,
    affectedOnly: booleanInput('affectedOnly', true),
  })
  const args = ['plan', '--targets-json', JSON.stringify(targets)]
  args.push(...(base ? [`--base=${base}`, `--head=${head}`] : ['--all']))
  const matrix = readJson(captureCli(context, args), 'Isox plan')
  if (!matrix || !Array.isArray(matrix.include)) {
    throw new Error('Isox did not return a matrix include array. Update the installed CLI.')
  }
  setOutput('matrix', matrix)
  setOutput('hasPlan', matrix.include.length > 0)
  setOutput('base', base || '')
  setOutput('head', head)
  const tasks = matrix.include.reduce((sum, row) => sum + row.projects.length, 0)
  summary(`## Isox plan\n\n${tasks} project commands across ${matrix.include.length} jobs. Selection: ${base ? 'affected' : 'all projects'}.\n`)
  process.stdout.write(`${JSON.stringify(matrix, null, 2)}\n`)
}

actionMain(import.meta.url, main)
