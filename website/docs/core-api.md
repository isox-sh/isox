---
title: "Core API"
description: "Discover workspaces, run executors, plan affected work, and use shared configuration and process APIs."
sidebarTitle: "Core API"
icon: "brackets-curly"
---

Workspace discovery, native command execution, configuration types, and logging
for [Isox](https://isox.sh). This package also supplies the built-in `run-command`
executor and JSON schemas.

For the command-line interface, install [`isox`](https://www.npmjs.com/package/isox).
Requires Node.js 24+.

## Install

```sh
npm install --save-dev @isox-sh/core
```

Install core directly when importing its APIs/types or referencing its schemas.
For CLI usage, `npm install --save-dev isox` installs core automatically, including
the built-in `@isox-sh/core:run-command` executor. A direct workspace installation
of core takes precedence over the CLI's copy when resolving commands.

## Shell-command executor

`core:run-command` is included with the CLI. It runs a shell command from the
workspace root, or from the directory selected by `options.cwd`.
See [shell commands](/docs/shell-commands) for configuration, tool flags, and
cancellation behavior.

## Core API

```typescript
import { findWorkspaceRoot, logger, parseWorkspace, runExecutor } from '@isox-sh/core'

async function main() {
  const root = await findWorkspaceRoot()
  const workspace = await parseWorkspace(root)
  await runExecutor(workspace, 'web', 'build', root, logger)
}

main().catch(error => {
  logger.error(error)
  process.exitCode = 1
})
```

`runExecutor` optionally accepts a configuration name as its sixth argument.
Named overrides are merged shallowly over the command's base options. Executors
receive the merged options and a native `ExecutorContext` containing project,
command, workspace, root paths, configuration name, verbosity, and logger.
Context project/command records retain the original configuration.

An optional eighth argument supplies executor option overrides. These replace
base and named-configuration values at the top level without mutating the workspace.
The CLI uses this argument for plugin flags such as `--fix`.

Use `resetWorkspace()` to remove the detected workspace's `.isox` directory.
Discovery reuses cached project definitions until reset or an explicit refresh.
It does not analyze imports or cache task results. See
[discovery caching](/docs/configuration#discovery-cache).

## Custom executors

See [custom executors and initializers](/docs/custom-executors) for the native
contract, plugin manifests, continuous results, and cancellation.
`runExecutor` accepts an optional `AbortSignal` as its seventh argument.
When that signal is aborted, an executor may stop by throwing its abort reason
or an `AbortError`. Isox treats these as cancellation, lets executor cleanup run,
and preserves the CLI's SIGINT/SIGTERM exit status. Other errors still fail the task.

`runProcess(file, args, { cwd, signal })` runs a child with inherited standard
streams and cancels its process tree when aborted. Plugins that need captured
output can spawn their own child and call
`handleProcessCancellation(child, signal, onError)`. Spawn it with
`detached: process.platform !== 'win32'` and call the returned cleanup function
on both `error` and `close` events. Cancellation sends SIGTERM, then SIGKILL after
two seconds by default on POSIX; Windows uses `taskkill` to terminate the tree.
Set `gracePeriodMs` in `runProcess` options, or pass it as the fourth argument to
`handleProcessCancellation`, to change that interval. CLI workers allow five
seconds so their executors can finish stopping subprocesses first.

## Types and schemas

Core exports `ProjectDefinition`, `ProjectConfiguration`, `ExecutorConfiguration`,
`WorkspaceGraph`, `Executor`, `ExecutorContext`, and result/logging types.
Project and command definitions accept custom properties.

Schemas ship at:

- `@isox-sh/core/schemas/project.schema.json`
- `@isox-sh/core/schemas/isox.schema.json`
- `@isox-sh/core/executors/run-command/run-command.schema.json`

## Logging

Core exports a small built-in `logger` with no logging dependencies.
Use `logger.debug`, `info`, `success`, `warn`, or `error` for tagged messages.
Informational messages go to stdout, warnings and errors to stderr. Debug output
is hidden by default; `isox build my-app --verbose` enables diagnostics, error
stack traces, and the native executor's `verbose` context flag (`isVerbose` in
the Nx adapter). Messages are written
immediately with a tag and level, for example `[Isox] INFO Loading workspace`.
In terminals, tags are gray and levels are colored: cyan for info, green for
success, yellow for warnings, red for errors, and magenta for debug. Redirected
output stays plain by default. Set `NO_COLOR=1` or `TERM=dumb` to disable colors,
or use `FORCE_COLOR=1` to force them (`FORCE_COLOR=0` disables them).
`FORCE_COLOR` takes precedence over the other environment settings.

Rebuilding `.isox/workspace.json` shows an animated progress indicator in an
interactive terminal, followed by the discovered project count and elapsed time.
Cache hits stay quiet. CI, redirected output, and `TERM=dumb` use plain log lines;
JSON-producing CLI commands keep these messages on stderr. The indicator stops
on both completion and failure, and respects the logger's level.

Running commands also show a spinner, then settle to success, failure, or
cancellation with elapsed time. Watch executors stop the initial spinner after
their first result and report each rebuild separately. Isox pauses its animation
while a child command owns the terminal, preserving that command's output and
interactive behavior. Parallel CLI workers use plain status lines to avoid
competing for the same terminal; `ISOX_PROGRESS=0` also disables animation.

For embedding or tests, `createLogger` creates an independent logger with custom
levels, tags, or reporters. Set `colors: true` or `colors: false` to override
automatic color detection and environment settings. Custom reporters receive
the original arguments without added colors. Pass it as the fifth argument to `runExecutor` to
control that invocation's logging. For example:

```typescript
import { createLogger, LogLevels } from '@isox-sh/core'

const logger = createLogger({ level: LogLevels.debug, tag: 'Isox' })
logger.info('Loading workspace')
logger.withTag('build').debug('Resolving executor')
```

## Reading and writing project JSON

Use `json(value)` to format a value as JSON text without writing a file:

```typescript
import { json } from '@isox-sh/core'

const source = json({ enabled: true })
```

It returns two-space-indented JSON with a trailing newline. Values that cannot
produce a JSON document, such as `undefined`, bigint, and circular objects, throw
a `TypeError`. `writeJson` uses the same serializer, and tests can reuse it for
fixtures or expected command output.

Use `writeJson` from an executor or initializer to write JSON within its project:

```typescript
import { writeJson } from '@isox-sh/core'

await writeJson('config/settings.json', { enabled: true }, context)
```

The project root must exist. Paths resolve from `context.projectRoot`; parent
directories inside the project are created as needed. Paths outside the project
and symlinks inside it are rejected. Writes are atomic, with two-space indentation
and a trailing newline. Pass `{ overwrite: false }` as the fourth argument when
existing files must be preserved.

After a successful write, the logger reports `Created file <path>` or
`Updated file <path>`. The path is workspace-relative, or project-relative when
`workspaceRoot` is omitted. The utility uses
`context.logger` when provided, otherwise core's default logger.

Read project JSON with the same path restrictions:

```typescript
import { readJson } from '@isox-sh/core'

interface Settings {
  enabled: boolean
}

const settings = await readJson<Settings>('config/settings.json', context)
```

`readJson` accepts UTF-8 JSON, including a leading byte order mark, and does not
log reads. Missing files retain their filesystem error codes; malformed JSON
throws a `SyntaxError` naming the file and preserving the original error as its
cause. Results default to `unknown`; a supplied TypeScript type does not perform
runtime validation.

Add dependencies to the project's `package.json` with `addDepsToPackageJson`:

```typescript
import { addDepsToPackageJson } from '@isox-sh/core'

await addDepsToPackageJson({
  dependencies: { example: '^1.0.0' },
  devDependencies: { '@isox-sh/nx': '0.0.1' },
}, context)
```

The helper creates a missing manifest, preserves other package metadata, and
keeps existing versions and dependency sections. It sorts sections it changes
and uses `readJson` and `writeJson` for project containment and file-action logging.
Repeated additions leave the file untouched. Run the workspace's package manager
afterward to install dependencies and update its lockfile.

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
See [cache fields and invalidation](/docs/configuration#discovery-cache) for details.

The resolver merges import and local package references with declared
`dependencies` in memory. Core also
exports `sourceDependencies(file, source, { includeTypes: true })` to inspect
literal import references; omit `includeTypes` to collect runtime references only.

## Scope and migration

`runExecutor` executes one project command. The CLI also offers affected selection,
weighted planning, and multiple commands in isolated child CLI processes.
Prerequisite task scheduling, task caching and sandboxing remain planned.
Separate processes do not isolate filesystem access or make execution hermetic.

The optional Nx adapter lives in the separately installed `@isox-sh/nx` package
and supports Nx 23 only, for initial migration. Adopt native
Isox commands before completing migration. See the
[project documentation](/docs/introduction) and
[roadmap](https://github.com/isox-sh/isox/blob/main/ROADMAP.md).
