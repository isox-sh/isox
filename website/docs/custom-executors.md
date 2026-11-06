---
title: "Custom executors"
description: "Implement native executors with context, continuous results, cancellation, and caching."
sidebarTitle: "Executors"
icon: "terminal"
---

Core exports `Executor`, `ExecutorContext`, and `ExecutorResult`. A native
executor receives the merged options (or `{}`) and this context:

| Field | Value |
| --- | --- |
| `workspaceRoot` | Absolute path to the detected workspace root |
| `projectRoot` | Absolute path to the project's directory |
| `projectName`, `commandName` | Names of the selected project and command |
| `configurationName` | Selected configuration, or `undefined` |
| `project`, `command` | Resolved project configuration and selected command |
| `workspace` | Workspace graph with its native `projects` dictionary |
| `logger` | Logger for this invocation |
| `verbose` | Whether debug logging is enabled |
| `signal` | Optional AbortSignal for cooperative cancellation |

## Executor implementation

```typescript
import type { Executor } from '@isox-sh/core'

interface BuildOptions {
  outputDir: string
}

const build: Executor<BuildOptions> = async (options, context) => {
  context.logger.info(`Building ${context.projectName} into ${options.outputDir}`)
  // Run the build here, then report its result.
  return { success: true }
}

export default build
```

An executor package declares `"executors": "./executors.json"` in its
`package.json`. That manifest maps names to implementation paths relative to the
manifest file, for example:

```json
{
  "executors": {
    "build": { "implementation": "./dist/executors/build/build.executor.js" }
  }
}
```

Install the package where its `package.json` can be resolved from the workspace
root. The loader uses CommonJS `require` and accepts a callable module export or
its `default` export. Executors return `{ success: true }`, a promise of that
result, or an async iterable of results. A failed or missing result, an empty
iterable, or a thrown error fails the command. Options are passed through without
core-level executor schema validation or schema defaults. Individual executors
may validate their own options, as `js:tsc` does.

## Continuous execution and cancellation

Long-running native executors can yield `{ success, continuous: true }` for
rebuilds. A failed continuous result is recoverable and is logged while the
stream continues. Ordinary failed results still stop execution. Continuous
commands do not receive final completion logging. Honor `context.signal` and
close resources in the iterator's `finally`/`return` path. The CLI cancels active
commands on SIGINT/SIGTERM; `js:tsc` also cancels its compiler process group.

The native [`js:tsc` executor](/docs/typescript) supports owned-output cleanup,
asset copying, optional package.json/exports generation, and watch configurations.
Use `isox build <project> --watch`, or select a configuration containing
`watch: true` with `--config=watch`.
The full contract and migration limits are documented in the
[TypeScript executor guide](/docs/typescript).

## Programmatic execution

For programmatic execution, call
`runExecutor(workspace, projectName, commandName, workspaceRoot, logger?, configurationName?, signal?, optionOverrides?, cacheOptions?)`.
The runner selects and merges options from the workspace configuration. Omit the
configuration name to use the command's default. `context.command` and the
workspace graph retain the definition with workspace target defaults already applied;
the executor's first argument contains the merged options. `runExecutor` accepts an optional
`AbortSignal` as its seventh argument and option overrides as its eighth. Overrides
replace selected configuration values at the top level. See the
[core API](/docs/core-api#core-api) for an invocation example.

## Executor resolution

First-party executor packages may omit the `@isox-sh/` prefix: `js:tsc` and
`core:run-command` are supported alongside their fully scoped names, as is
`vitest:test` and `eslint:lint`. Resolution first tries `@isox-sh/<name>`, then the unscoped name
if the first-party package cannot be found. This selects the Isox executor even
when the workspace also installs Vitest itself. Invalid manifests or missing
commands in the resolved package report errors without falling back.

See the [core API](/docs/core-api) for programmatic use, JSON helpers, logging,
and the built-in shell-command executor.

## Cacheable execution

Native targets can opt into [local task caching](/docs/task-caching) with `cache: true`
and optional disposable output directories. Omit outputs for log-only results.
A cache hit skips the executor and restores declared outputs. Keep file writes
inside those directories and declare all file/environment inputs. Core captures Node stdout/stderr and child output from
`runProcess`; use that helper for spawned commands so cancellation and terminal
replay work together. Continuous results, failures and cancellation are never
stored as successful finite tasks.

See [layout and packaging](/docs/plugin-packaging) to ship your executor and
[plugin testing](/docs/plugin-testing) to exercise it through the CLI.
