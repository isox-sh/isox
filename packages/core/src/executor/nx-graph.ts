import type { CommandConfiguration } from '../workspace/parser'
import type { ExecutorContext } from './types'

export interface NxProjectConfiguration {
  [key: string]: unknown
  name: string
  root: string
  targets: Record<string, CommandConfiguration>
  implicitDependencies: string[]
  tags: string[]
}

export interface NxProjectGraph {
  nodes: Record<string, { name: string, type: 'app' | 'lib' | 'e2e', data: NxProjectConfiguration }>
  dependencies: Record<string, { source: string, target: string, type: string }[]>
  externalNodes?: Record<string, { name: string, type: 'npm', data: { packageName: string, version: string, [key: string]: unknown } }>
  [key: string]: unknown
}

/** Keep Nx's inferred dependencies, with Isox's explicit configuration authoritative. */
export function createNxProjectGraph(projects: Record<string, NxProjectConfiguration>, inferred?: NxProjectGraph): NxProjectGraph {
  const nodes = { ...inferred?.nodes, ...Object.fromEntries(Object.entries(projects).map(([name, project]) => [name, {
    name,
    type: project.projectType === 'application' ? 'app' as const : 'lib' as const,
    data: { ...inferred?.nodes[name]?.data, ...project },
  }])) }
  const dependencies: NxProjectGraph['dependencies'] = Object.assign(Object.create(null), inferred?.dependencies)
  for (const [source, project] of Object.entries(projects)) {
    const edges = [...(dependencies[source] ?? [])]
    for (const target of project.implicitDependencies) {
      if (!Object.hasOwn(nodes, target)) {
        throw new Error(`Cannot create Nx project graph: project ${source} depends on unknown project ${target}. Use explicit Isox project names in dependencies.`)
      }
      if (!edges.some(edge => edge.target === target)) edges.push({ source, target, type: 'implicit' })
    }
    dependencies[source] = edges
  }

  return { ...inferred, nodes, dependencies, externalNodes: inferred?.externalNodes ?? {} }
}

/** Describe the one task Isox is actually running, without inventing prerequisites. */
export function createNxTaskGraph(context: ExecutorContext) {
  const id = `${context.projectName}:${context.commandName}${context.configurationName ? `:${context.configurationName}` : ''}`
  return {
    roots: [id],
    tasks: {
      [id]: {
        id,
        target: {
          project: context.projectName,
          target: context.commandName,
          ...(context.configurationName ? { configuration: context.configurationName } : {}),
        },
        projectRoot: context.project.root,
        overrides: {},
        // Isox does not compute or cache task outputs.
        outputs: [],
        cache: false,
        parallelism: context.command.parallelism !== false,
        continuous: context.command.continuous === true,
      },
    },
    dependencies: { [id]: [] },
    continuousDependencies: { [id]: [] },
  }
}
