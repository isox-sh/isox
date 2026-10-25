# Core API and shell commands

[Documentation index](README.md)

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

Add a command to a project's `project.json`:

```json
{
  "name": "web",
  "executors": {
    "build": {
      "executor": "@isox-sh/core:run-command",
      "options": {
        "command": "npm run build",
        "cwd": "apps/web"
      }
    }
  }
}
```

Run `isox build web`. The shell command inherits the environment and standard
streams. `cwd` is optional and resolves relative to the workspace root; an
absolute path is also accepted. A nonzero exit or termination fails the task.

The executor accepts `command` as a shell string. It does not substitute Nx
tokens or schedule dependencies.
If the workspace has no directly resolvable core package, built-in commands use
the CLI's core dependency. This works with pnpm and global CLI installations.
A workspace-installed copy takes precedence; invalid workspace packages still
report errors. Other executor packages must resolve from the workspace root.

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

Use `resetWorkspace()` to remove the detected workspace's `.isox` directory.
Discovery reads cached project configuration until reset; this is not task-result
caching.

## Custom executors

See [custom executors and initializers](custom-executors.md) for the native
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
- `@isox-sh/core/dist/executors/run-command/run-command.schema.json`

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

const settings = await readJson<{ enabled: boolean }>('config/settings.json', context)
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
import { createProjectMatrix, getAffectedProjects, getGitChanges, parseWorkspace, readWorkspaceSettings } from '@isox-sh/core'

const workspace = await parseWorkspace(root, { cache: false })
const settings = await readWorkspaceSettings(root)
const changes = await getGitChanges(root, { base: 'origin/main', head: 'HEAD' })
const projects = getAffectedProjects(workspace, changes.files, settings.affected)
const matrix = createProjectMatrix(workspace, projects, [{ target: 'test', maxJobs: 3 }])
```

`parseWorkspace` accepts an optional logger and `cache: false` to bypass cached
reads and refresh the saved workspace. `getAffectedProjects` propagates changed
files through inferred and explicitly declared dependency edges; `createProjectMatrix` applies command
and tag filters, checks configurations, and distributes project weights. It
returns the same matrix contract used by the CLI and actions. See the
[affected and CI guide](affected-and-ci.md) for complete semantics.

Discovery merges import and local package references into each cached project's
`dependencies`. The source `project.json` retains only manual additions. Core also
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
[project documentation](README.md) and
[roadmap](../ROADMAP.md).
