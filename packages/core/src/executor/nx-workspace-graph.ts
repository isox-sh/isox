import { fork } from 'node:child_process'
import { createRequire } from 'node:module'
import { join } from 'node:path'

import type { NxProjectGraph } from './nx-graph'
import type { ExecutorContext } from './types'

export type NxGraphMessage = { graph: NxProjectGraph } | { error: string }

/** Resolve Nx beside the executor, including plugins installed through pnpm. */
export async function loadNxWorkspaceGraph(context: ExecutorContext, pluginPackagePath: string): Promise<NxProjectGraph | undefined> {
  const pluginRequire = createRequire(pluginPackagePath)
  let nxPackagePath: string
  try {
    nxPackagePath = pluginRequire.resolve('nx/package.json')
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'MODULE_NOT_FOUND') throw error
    context.logger.debug('Nx is not installed beside the executor. Using explicit Isox project dependencies.')
    return undefined
  }
  const graphModule = createRequire(nxPackagePath).resolve('nx/src/project-graph/project-graph')
  context.logger.debug('Refreshing Nx project graph and file dependency map...')

  // Nx binds its root and caches to process state. A child keeps different
  // workspaces isolated and writes the file map that Nx package generation reads.
  return new Promise((resolve, reject) => {
    const child = fork(join(__dirname, 'nx-graph-worker.js'), [graphModule], {
      cwd: context.workspaceRoot,
      execArgv: [],
      stdio: ['ignore', 'inherit', 'inherit', 'ipc'],
      env: {
        ...process.env,
        NX_WORKSPACE_ROOT_PATH: context.workspaceRoot,
        NX_DAEMON: 'false',
        NX_ISOLATE_PLUGINS: 'false',
        NX_CACHE_PROJECT_GRAPH: 'true',
        NX_FORCE_REUSE_CACHED_GRAPH: 'false',
      },
    })
    let result: NxGraphMessage | undefined
    child.on('message', (message: NxGraphMessage) => { result = message })
    child.once('error', reject)
    child.once('exit', (code, signal) => {
      if (result && 'error' in result) {
        reject(new Error(`Cannot build Nx project graph: ${result.error}`))
      } else if (code !== 0 || !result || !('graph' in result)) {
        reject(new Error(`Cannot build Nx project graph: worker exited with ${signal ?? code}.`))
      } else {
        resolve(result.graph)
      }
    })
  })
}
