---
title: "Plugin helpers"
description: "Use logging, project JSON helpers, and target defaults in plugins."
icon: "toolbox"
---

Use these helpers to report progress and update configuration without discarding project metadata. Install `@isox-sh/core` directly when importing its APIs.

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
interactive behavior. Multi-project commands use a live footer with running
tasks, progress counts, and cache totals. Completed task results stay above the
footer; failed tasks include their diagnostics. The parent manages the display
so parallel workers do not compete for the terminal. CI and redirected output
use compact completion lines and show tool diagnostics for failed tasks;
`ISOX_PROGRESS=0` also disables animation.
Noninteractive tools such as ESLint stream their output through Isox: the spinner
keeps animating while they are quiet and pauses when diagnostics arrive.

For embedding or tests, `createLogger` creates an independent logger with custom
levels, tags, or reporters. Set `colors: true` or `colors: false` to override
automatic color detection and environment settings. Custom reporters receive
the original arguments without added colors. `taskOutput: 'compact'` selects
compact executor completion messages; reporters receive these with `format: 'task'`.
Pass the logger as the fifth argument to `runExecutor` to
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

Pass `{ upgradeExisting: true }` as the third argument to upgrade older versions
in their existing section. Version ranges are compared by their minimum allowed
version. Equal or newer versions and non-semver references such as `workspace:*`,
tags, and file paths are preserved.

## Target defaults for generators

`TargetDefaults` describes shared options, configurations and cache declarations.
`resolveTargetDefaults(workspace, settings)` returns a graph with merged targets
without modifying either input. `parseWorkspace` applies it during discovery and
caches the resulting targets. `runExecutor` executes the supplied graph without
reapplying defaults. When constructing a graph manually, call
`resolveTargetDefaults` first if workspace defaults should apply.

Generators can call `addTargetDefaults(executor, defaults, context)` to add missing
executor-level fields to `isox.json`. It recognizes first-party scoped/shorthand
aliases, preserves explicit values and unrelated workspace metadata, and leaves
complete existing entries untouched.

[Back to Core API](/docs/core-api).
