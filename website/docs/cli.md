---
title: "CLI reference"
description: "Run project commands, select named configurations, and manage workspace discovery."
sidebarTitle: "CLI reference"
icon: "terminal"
---

## Commands

| Command | Behavior |
| --- | --- |
| `isox init` | Create `isox.json` in the current directory |
| `isox init <package> <path> [--importPath=<name>]` | Scaffold a project using an installed package inside an existing workspace |
| `isox add <package> <project>` | Run an installed plugin’s add generator on an existing project |
| `isox <command> <project>` | Run a project's configured command |
| `isox run <project>:<command>` | Alternative syntax, including commands whose names are reserved by the CLI |
| `isox affected --target=<command>` | Run changed projects and their dependents; add `--print-matrix` for a JSON project array |
| `isox plan --target=<command> --max-jobs=3` | Print an affected, weighted GitHub Actions matrix; use `--all` to select every matching project |
| `isox run-many --target=<command> --projects=core,cli` | Run selected projects with optional `--parallel` |
| `isox reset` | Remove `.isox`; definitions and dependency analysis are recreated when next requested |
| `isox --help` | Show usage |

In `isox build web`, `build` is the target name and `web` is the project name.
Use `isox run web:build` when you prefer an explicit reference, or when the target
name conflicts with a built-in CLI command such as `add` or `init`.
Prefix examples with `npx`, `pnpm exec`, or `yarn` for a local CLI installation.

## Executor option overrides

Use `--verbose` for debug logging and error stacks. Execution commands forward
unknown flags to the executor as option overrides:

```sh
isox lint my-app --fix --max-warnings=5
isox run my-app:lint --no-fix
isox run-many --target=lint --fix
isox affected --target=lint --fix
```

Hyphenated names become camelCase (`--max-warnings` becomes `maxWarnings`). Bare
flags are `true`, `--no-<name>` is `false`, numeric values become numbers, and
repeated flags become arrays. Executors may validate the options they support.
Isox's own flags, such as `--verbose`, `--config`, and `--parallel`, stay with the CLI.
`init`, `add`, `reset`, and `plan` reject unknown flags.

Use `--options` for a JSON object when values need explicit types, nested objects,
or names that overlap with CLI flags:

```sh
isox build my-app --options '{"release":"001","settings":{"minify":true}}'
```

Forwarded executor-option flags take precedence over `--options`. Reserved CLI
flags do not override executor options: for example, `run-many --parallel=4`
with `--options '{"parallel":2}'` runs up to four projects concurrently while
passing `parallel: 2` to each executor. In multi-project execution,
overrides apply only to the requested target; pre/post targets keep their own options.

## Pre and post stages

For `affected`, `plan`, and `run-many`, `--pre-targets` and `--post-targets` accept
comma- or newline-separated command lists. Use `--pre-targets-json` and
`--post-targets-json` for exact arrays, including command names that contain
commas. For example, `--pre-targets-json '["prepare,assets:acc"]'` runs
`prepare,assets` with its `acc` configuration. Do not combine a list flag with its
JSON counterpart. See [affected projects and CI](/docs/affected-and-ci) for stage ordering.

`run-many` and executing `affected` show a live progress footer in interactive
terminals. It lists running tasks with elapsed times and counts pending,
completed, failed, and cached tasks, plus a completion bar. Cyan indicates running
work, green indicates success, and red highlights failures and their diagnostics.
Results are indented beneath the stage heading; diagnostics are indented beneath
the failed task. Colors respect `NO_COLOR`, `FORCE_COLOR`, and terminal support.
Completed results stay above the footer:

```text
   ✔ isox run api:build:production (1.25s)
   ✔ isox run web:build:production [local cache]

   Successfully ran target build for 2 projects (1.30s)
   1/2 tasks read from cache
```

Successful tool output is hidden in the live display. Failed and cancelled tasks
print their captured diagnostics beneath their result; large output is truncated
with an explicit notice. The final summary includes failures,
cancellations, and tasks that never started.

CI, redirected output, and `ISOX_PROGRESS=0` stream tool output and print static
results and summaries without cursor animation. Use `--verbose` for detailed
lifecycle messages and streamed output instead of the compact display.

## Named configurations

Commands can define named option overrides in `configurations` and select a
fallback with `defaultConfiguration`. For example, a command definition can be:

```json
{
  "executor": "@isox-sh/core:run-command",
  "options": {
    "command": "node scripts/build.js",
    "cwd": "."
  },
  "defaultConfiguration": "development",
  "configurations": {
    "development": {},
    "production": { "command": "node scripts/build.js --production" },
    "staging": { "command": "node scripts/build.js --staging" }
  }
}
```

Use your own build script and select a configuration with:

```bash
isox build my-app --prod
isox build my-app --config=staging
isox run my-app:build --configuration production
isox build my-app -c staging
```

`--prod` selects `production`. `--config`, `--configuration`, and `-c` are aliases;
an explicit name takes precedence over `--prod`, then `defaultConfiguration`
applies if neither selects a name. Without any selection or default, only base
options are used. An unknown configuration fails with an error. Names retain
their exact spelling, including leading zeros in names such as `001`.

Options are merged at the top level:
`{ ...options, ...configurations[name], ...cliOverrides }` after
[workspace target defaults](/docs/configuration#target-defaults) are merged.
Nested objects and arrays are replaced rather than recursively merged. This
works with native and Nx executors, including automatically migrated Nx project
files. The source configuration and workspace cache retain their original values;
the selected options are computed for each invocation. Only one configuration
can be selected per invocation. Executor CLI flags override the selected configuration.

## Workspace cache

Isox stores project definitions with merged target defaults and explicit
dependencies in `.isox/workspace.json`. Project lookup reads that file directly,
without recalculating defaults or analyzing sources and imports. Run `isox reset`
after changing project definitions, target defaults, or discovery rules. Source
edits do not invalidate this cache.

`affected`, `plan`, and `run-many` read current definitions and rewrite
`workspace.json` on every invocation. Workers spawned by `run-many` then load
that cache. Selection does not infer dependencies; execution resolves
them when selected targets cache outputs, to order selected builds safely.
Affected selection additionally requests dependency analysis. Results are cached
separately in `.isox/discovery.json`, checked only when analysis is requested.
Executors request analysis themselves when needed; selecting all projects does
not infer a graph.

A dependency-cache hit reuses dependency lists, not task results. Source metadata
or resolution changes can invalidate an entry; reanalysis reads the invalidated
project's included sources, including tests, rather than just the edited file.
Unchanged dependency projects can still reuse their entries. A dependency-analysis hit alone does not skip an executor. Native targets with
`cache: true` additionally hash their inputs and can restore [task results](/docs/task-caching).
Use `--skip-cache` on execution commands to bypass result reads and writes.

Reset removes the whole `.isox` directory, including task results, TypeScript ownership records
and build locks; stop active builds first. It does not delete compiled output.
The next project lookup recreates `workspace.json`; dependency analysis recreates
`discovery.json` only when requested. Source or import edits do not require reset.

See [cache behavior and invalidation](/docs/configuration#discovery-cache) for details and
[Nx migration](/docs/nx-migration) for temporary adapter support.

## Current scope

Affected selection follows inferred and explicitly declared dependencies. Parallel execution uses
separate child CLI processes, and the GitHub actions distribute exact weighted
project lists. See [affected projects and CI](/docs/affected-and-ci).
Cached builds with declared outputs wait for selected dependencies, even with
`--parallel=1`. Independent projects can run concurrently. Unselected prerequisites
are not added; prepare their required outputs before running workers.
Local task caching is opt-in; remote caching,
dependency task scheduling and isolation remain on the [roadmap](https://github.com/isox-sh/isox/blob/main/ROADMAP.md).
