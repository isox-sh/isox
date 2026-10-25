import { resolveRevision } from '../shared/git.mjs'
import { actionMain, cliContext, input, readJson, runCli, summary } from '../shared/runtime.mjs'

/** A worker consumes the exact planner output; it never recomputes affected projects or shards. */
export function workerArgs(plan) {
  if (!plan || typeof plan !== 'object' || Array.isArray(plan)
    || typeof plan.target !== 'string' || !/^[^\s:]+$/.test(plan.target)
    || !Array.isArray(plan.projects) || plan.projects.some(name => typeof name !== 'string' || !/^[^\s:]+$/.test(name))
    || new Set(plan.projects).size !== plan.projects.length) {
    throw new Error('plan must be a matrix row containing a target and an exact array of unique project names.')
  }

  const args = ['run-many', `--target=${plan.target}`, '--projects-json', JSON.stringify(plan.projects)]

  if (plan.config !== undefined && typeof plan.config !== 'string') {
    throw new Error('Plan config must be a string.')
  }

  if (plan.config) {
    args.push(`--config=${plan.config}`)
  }

  if (plan.parallel !== undefined) {
    if (!Number.isSafeInteger(plan.parallel) || plan.parallel < 1 || plan.parallel > 256) {
      throw new Error('Plan parallel must be an integer between 1 and 256.')
    }

    args.push(`--parallel=${plan.parallel}`)
  }

  // Keep exact stage names. The installed CLI validates them through core's planner contract.
  for (const [field, flag] of [['preTargets', '--pre-targets-json'], ['postTargets', '--post-targets-json']]) {
    if (plan[field] !== undefined) {
      args.push(flag, JSON.stringify(plan[field]))
    }
  }

  return args
}

export async function main() {
  const context = cliContext()
  const plan = readJson(input('plan'), 'plan')
  const args = workerArgs(plan)
  const head = input('head')

  if (head && resolveRevision(context, head) !== resolveRevision(context, 'HEAD')) {
    throw new Error('This checkout does not match the plan head. Check out the same commit in the plan and worker jobs.')
  }

  try {
    await runCli(context, args)
    summary(`## Isox worker\n\nCompleted ${plan.projects.length} project commands.\n`)
  } catch (error) {
    summary('## Isox worker\n\nFailed or cancelled. See the command logs for details.\n')
    throw error
  }
}

actionMain(import.meta.url, main)
