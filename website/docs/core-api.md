---
title: "Core API"
description: "Discover workspaces, run executors, plan affected work, and use shared configuration and process APIs."
sidebarTitle: "Core API"
icon: "brackets-curly"
---

Workspace discovery, native command execution, configuration types, and logging
for [Isox](https://isox.sh). This package also supplies the built-in `run-command`
executor and JSON schemas.

For the command-line interface, install [`@isox-sh/cli`](https://www.npmjs.com/package/@isox-sh/cli).
Requires Node.js 24+.

## Install

```sh
npm install --save-dev @isox-sh/core
```

Install core directly when importing its APIs/types or referencing its schemas.
For CLI usage, `npm install --save-dev @isox-sh/cli` installs core automatically, including
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
Context project/command records include merged workspace target defaults. Named
configuration and CLI overrides are supplied as executor options without rewriting
those records.

An optional eighth argument supplies executor option overrides. These replace
base and named-configuration values at the top level without mutating the workspace.
The CLI uses this argument for plugin flags such as `--fix`.

Use `resetWorkspace()` to remove the detected workspace's `.isox` directory.
Discovery merges `isox.json` target defaults once and stores the effective project
definitions in `workspace.json`. Cache hits reuse them until reset or an explicit
refresh with `parseWorkspace(root, { cache: false })`.
It does not analyze imports or cache task results. See
[discovery caching](/docs/discovery-cache#discovery-cache).

## Custom executors

See [custom executors](/docs/custom-executors) for the native
contract, plugin manifests, continuous results, and cancellation.
`runExecutor` accepts an optional `AbortSignal` as its seventh argument.
When that signal is aborted, an executor may stop by throwing its abort reason
or an `AbortError`. Isox treats these as cancellation, lets executor cleanup run,
and preserves the CLI's SIGINT/SIGTERM exit status. Other errors still fail the task.

`runProcess(file, args, { cwd, signal })` runs a child and cancels its process tree
when aborted. Standard streams are inherited by default; during task-log capture,
stdout and stderr are piped through Isox for live output and later replay.
Set `output: 'pipe'` to stream noninteractive output through Isox even without caching.
Plugins that need to process child output themselves can spawn a child and call
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

See [Logging](/docs/plugin-helpers#logging).

## Reading and writing project JSON

See [Reading and writing project JSON](/docs/plugin-helpers#reading-and-writing-project-json).

## Affected selection and planning

See [Affected selection and planning](/docs/planning-api#affected-selection-and-planning).

## Scope and migration

`runExecutor` expands the requested target's `dependsOn` graph and executes its
prerequisites before the project command. The CLI also offers affected selection,
weighted planning, and multiple commands in isolated child CLI processes.
Native targets can opt into [local task caching](/docs/task-caching).
The ninth argument to `runExecutor` accepts `TaskCacheOptions`, for example
`{ skipCache: true }`, independently of the eighth argument's executor overrides.
See [task prerequisites](/docs/task-prerequisites#task-prerequisites) for syntax and
configuration propagation. Remote caching and sandboxing remain planned.
Separate processes do not isolate filesystem access or make execution hermetic.

The optional Nx adapter lives in the separately installed `@isox-sh/nx` package
and supports Nx 23 only, for initial migration. Adopt native
Isox commands before completing migration. See the
[project documentation](/docs/introduction) and
[roadmap](https://github.com/isox-sh/isox/blob/main/ROADMAP.md).

## Target defaults for generators

See [Target defaults for generators](/docs/plugin-helpers#target-defaults-for-generators).
