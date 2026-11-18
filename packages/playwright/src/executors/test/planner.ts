import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { positiveInteger, runProcess } from '@isox-sh/core'

import { testArgs, validateShard } from './options'

import type { PlaywrightOptions } from './options'
import type { ExecutorPlannerContext } from '@isox-sh/core'

function requestedJobs(options: PlaywrightOptions, plannerOptions: Record<string, unknown>): number | undefined {
  if (options.shard !== undefined) {
    validateShard(options.shard)

    return undefined
  }

  const { shards } = plannerOptions
  if (shards === undefined || shards === 'auto') {
    return undefined
  }

  if (typeof shards !== 'number') {
    throw new Error('Playwright planner.shards must be "auto" or an integer between 1 and 256.')
  }

  return positiveInteger(shards, 'Playwright planner.shards')
}

function shards(total: number) {
  return Array.from({ length: total }, (_, i) => ({ shard: `${i + 1}/${total}` }))
}

async function automaticShards(options: PlaywrightOptions, context: ExecutorPlannerContext, reportDir: string) {
  const args = [
    ...testArgs(options, context.workspaceRoot, context.projectRoot),
    '--list', '--pass-with-no-tests', '--add-reporter', join(__dirname, 'count-reporter.js')
  ]
  // Configured reporters may filter tests. Isolate their standard report files during discovery.
  const env = {
    ...process.env,
    PLAYWRIGHT_HTML_OPEN: 'never',
    PLAYWRIGHT_HTML_OUTPUT_DIR: join(reportDir, 'html'),
    PLAYWRIGHT_BLOB_OUTPUT_FILE: join(reportDir, 'blob.zip'),
    PLAYWRIGHT_JUNIT_OUTPUT_FILE: join(reportDir, 'junit.xml'),
    PLAYWRIGHT_JSON_OUTPUT_FILE: join(reportDir, 'report.json'),
    PLAYWRIGHT_PERFETTO_OUTPUT_FILE: join(reportDir, 'perfetto.json'),
  }

  async function countTests(shard?: string): Promise<number | undefined> {
    let count: number | undefined
    let keepProject = false
    let diagnostic = ''
    // List mode includes unfocused tests. A focused suite must run with Playwright's own selection.
    const flags = shard ? [...args, '--forbid-only', `--shard=${shard}`] : args
    const result = await runProcess(process.execPath, flags, {
      cwd: context.projectRoot,
      env,
      onMessage(message) {
        if (message && typeof message === 'object' && 'count' in message && typeof message.count === 'number'
          && 'hasGlobalSetup' in message && 'hasShard' in message) {
          count = message.count
          keepProject = Boolean(message.hasGlobalSetup || (!shard && message.hasShard))
        }
      },
      onOutput(chunk, stream) {
        if (!shard && stream === 'stderr') {
          diagnostic = (diagnostic + chunk).slice(-16_384)
        }
      },
    })
    // List mode skips global setup, including setup that generates test inputs.
    if (keepProject || (shard && !result.success)) {
      return undefined
    }

    if (!result.success || count === undefined) {
      throw new Error(`Playwright test discovery failed for ${context.projectName}.\n${diagnostic.trim()}`.trimEnd())
    }

    return count
  }

  const testCount = await countTests()
  const total = Math.min(context.maxJobs, testCount ?? 0)
  if (total < 2) {
    return [{}]
  }

  // Keep Playwright's denominator when serial suites or large files leave gaps.
  const populated = []
  for (const part of shards(total)) {
    const count = await countTests(part.shard)
    if (count === undefined || count === testCount) {
      return [{}]
    }

    if (count > 0) {
      populated.push(part)
    }
  }

  return populated.length > 1 ? populated : [{}]
}

async function plan(options: PlaywrightOptions, context: ExecutorPlannerContext) {
  if (options.shard !== undefined) {
    return [{}]
  }

  const fixed = requestedJobs(options, context.plannerOptions)
  if (fixed !== undefined) {
    return shards(fixed)
  }

  const reportDir = await mkdtemp(join(tmpdir(), 'isox-playwright-'))

  try {
    return await automaticShards(options, context, reportDir)
  } finally {
    await rm(reportDir, {
      recursive: true,
      force: true
    })
  }
}

export default Object.assign(plan, { requestedJobs })
