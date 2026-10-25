import { createRequire } from 'node:module'
import { inspect } from 'node:util'

import type { NxProjectGraph } from './nx-graph'
import type { NxGraphMessage } from './nx-workspace-graph'

async function main(): Promise<void> {
  let message: NxGraphMessage
  try {
    const graphModule = process.argv[2]
    const { createProjectGraphAsync } = createRequire(__filename)(graphModule) as {
      createProjectGraphAsync: (options: { exitOnError: boolean }) => Promise<NxProjectGraph>
    }
    message = { graph: await createProjectGraphAsync({ exitOnError: false }) }
  } catch (error) {
    // Nx graph errors can contain nested plugin errors; retain their diagnostics.
    message = { error: inspect(error, { depth: 6, colors: false }) }
  }

  const code = 'error' in message ? 1 : 0
  // Nx plugins may leave workers/watchers alive. Flush IPC before exiting.
  process.send!(message, error => process.exit(error ? 1 : code))
}

void main()
