---
title: "Planning API"
description: "Select affected projects and build execution plans programmatically."
icon: "code-branch"
---

Use these APIs when building CI integrations or tooling around affected project selection. For a ready-to-use workflow, see [GitHub Actions](/docs/github-actions).

## Affected selection and planning

Core exports `createProjectGraph`, `getGitChanges`, `getAffectedProjects`,
`selectProjects`, and `createProjectMatrix` for programmatic planning:

```ts
import { createProjectMatrix, findWorkspaceRoot, getAffectedProjects, getGitChanges, parseWorkspace, readWorkspaceSettings, resolveWorkspaceDependencies } from '@isox-sh/core'

const root = await findWorkspaceRoot()
const definitions = await parseWorkspace(root, { cache: false })
const workspace = await resolveWorkspaceDependencies(root, definitions)
const settings = await readWorkspaceSettings(root)
const changes = await getGitChanges(root)
const projects = getAffectedProjects(workspace, changes.files, settings.affected)
const matrix = createProjectMatrix(workspace, projects, [{ target: 'test', maxJobs: 3 }])
```

`getGitChanges(root)` honors `affected.defaultBase` and the Git environment
variables. Pass `base` and `head` options to override them.

`parseWorkspace` accepts an optional logger and `cache: false` to refresh saved
project definitions. It never infers dependencies. `resolveWorkspaceDependencies`
returns a new workspace with inferred edges without modifying or persisting the
definitions. `getAffectedProjects` propagates changed
files through inferred and explicitly declared dependency edges; `createProjectMatrix` applies command
and tag filters, checks configurations, and distributes project weights. It
returns the same matrix contract used by the CLI and actions. See the
[affected and CI guide](/docs/affected-and-ci) for complete semantics.

Pass `{ projects: ['web'] }` as the resolver's third argument to limit source
analysis to that project and its transitive dependencies. This still reads workspace
package/configuration metadata to resolve names, aliases and output ownership;
unrelated source files are not parsed. Projects outside the requested closure
retain their declared dependencies. Use the full graph for affected selection.
Always pass the original definitions to a fresh request so old inferred edges
are not treated as declarations.

The resolver checks `.isox/discovery.json` only when called. It validates requested
projects' source metadata and resolution inputs against current configuration,
reuses valid results, and saves missing or changed analysis atomically. A scoped
cache is never treated as a complete graph. Pass `logger` in the options to route
cache diagnostics alongside the caller's other logs. `resetWorkspace()` clears
both definitions and dependency caches.

The per-project `sources` fingerprint hashes paths and file metadata, not source
contents or extracted imports. A changed fingerprint triggers analysis of all
included sources in that project; this is project-level caching, not a per-file
incremental parser. Body/comment edits can therefore invalidate it. Unchanged
entries skip parsing but still require metadata and resolution checks. Source
discovery includes tests and is not limited to a compiler's configured input list.
Configuration/package metadata is read fresh on each resolver request.

`parseWorkspace` never opens or validates `discovery.json`. With `cache: false`,
it refreshes project definitions only; call the resolver explicitly when needed.
See [cache fields and invalidation](/docs/discovery-cache#discovery-cache) for details.

The resolver merges import and local package references with declared
`dependencies` in memory. Core also
exports `sourceDependencies(file, source, { includeTypes: true })` to inspect
literal import references; omit `includeTypes` to collect runtime references only.

[Back to Core API](/docs/core-api).
