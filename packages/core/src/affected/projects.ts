import { posix } from 'node:path'

import { collectDependents, createProjectGraph } from '../workspace/graph'
import { createTagFilter } from './tags'
import { validateName } from './targets'

import type { WorkspaceGraph } from '../workspace/parser'

// These affect the whole workspace even when a root project owns their paths.
const workspaceFiles = [
  'isox.json', 'package.json', 'package-lock.json', 'npm-shrinkwrap.json',
  'pnpm-lock.yaml', 'pnpm-workspace.yaml', 'yarn.lock', 'bun.lock', 'bun.lockb',
  'tsconfig*.json', 'eslint.config.*', '.github/**',
]

/** Unowned files conservatively affect every project, including removed project roots. */
export function getAffectedProjects(workspace: WorkspaceGraph, files: string[], options: { globalFiles?: string[] } = {}): string[] {
  const graph = createProjectGraph(workspace)
  const projects = Object.values(workspace.projects).map(project => ({
    name: project.name,
    root: posix.normalize(project.root.replaceAll('\\', '/')).replace(/\/$/, ''),
  })).sort((a, b) => {
    const aLength = a.root === '.' ? 0 : a.root.length
    const bLength = b.root === '.' ? 0 : b.root.length
    return bLength - aLength || compareNames(a.name, b.name)
  })
  const directlyAffected = new Set<string>()
  const globalFiles = [...workspaceFiles, ...(options.globalFiles ?? [])]

  for (const file of files) {
    if (globalFiles.some(pattern => posix.matchesGlob(file, pattern))) {
      return Object.keys(workspace.projects).sort()
    }
    const owner = projects.find(project => project.root === '.' || file === project.root || file.startsWith(`${project.root}/`))
    if (!owner) {
      return Object.keys(workspace.projects).sort()
    }
    directlyAffected.add(owner.name)
  }
  return collectDependents(graph, directlyAffected)
}

/** Code-point ordering avoids locale-dependent plans across CI workers. */
export function compareNames(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0
}

export function selectProjects(workspace: WorkspaceGraph, projects: string[], target: string, tag?: string): string[] {
  validateName(target, 'target')
  const matches = createTagFilter(tag)
  return [...new Set(projects)].sort().filter(name => {
    if (!Object.hasOwn(workspace.projects, name)) {
      throw new Error(`Project ${name} not found in workspace.`)
    }
    const project = workspace.projects[name]
    return Object.hasOwn(project.targets ?? {}, target)
      && !project.tags?.includes('ci=off')
      && matches(project.tags ?? [])
  })
}
