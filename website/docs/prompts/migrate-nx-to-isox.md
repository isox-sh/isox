---
title: "AI migration prompt"
description: "A reusable prompt for migrating an Nx workspace to Isox while preserving build, test, and CI behavior."
sidebarTitle: "AI migration prompt"
icon: "wand-magic-sparkles"
---

Use the following instructions as a task prompt for an AI coding agent working
inside the repository to migrate.

---

Migrate this repository from Nx orchestration to Isox. Inspect the repository
before editing, preserve its working build/test/lint behavior, and implement and
verify the migration. Follow repository instructions and preserve unrelated
changes. Do not commit, publish, or deploy unless separately requested.

Isox's Nx integration supports **Nx 23 only** and exists solely for initial
migration and evaluation. Once the user decides to keep using Isox, complete
the migration to native Isox commands and underlying tools, including replacing
Nx executors and config helpers. Retaining the adapter is an intermediate step,
not a completed migration.

Use the [active roadmap](https://github.com/isox-sh/isox/blob/main/ROADMAP.md) to distinguish implemented Isox behavior
from planned prerequisite scheduling, caching, and isolation features. Use the
[affected and CI guide](/docs/affected-and-ci) to replace Nx affected commands and
nx-extend matrix actions with native Isox selection and weighted plans.

## 1. Inspect the existing behavior

Identify the package manager, lockfile, runtime versions, workspace layout,
projects, scripts, CI jobs, and installed Nx/plugin versions. Record a baseline
of the relevant checks and any existing failures.

Before using the temporary Nx adapter, confirm that the installed Nx runtime is
23.x and retained plugins are compatible with it. Other Nx versions are
unsupported; migrate their commands directly to native tools or Isox executors.

Inventory each project's effective targets, including inferred targets, project
and package configuration, and workspace defaults. Use the installed Nx CLI's
inspection commands where available; inspect its help for version-specific
syntax. Do not assume that copying `project.json` captures all behavior: Nx also
derives project configuration from plugins and `nx.json` defaults. See
[Nx's project configuration reference](https://nx.dev/docs/reference/project-configuration).

For every command used locally or in CI, record its actual tool invocation,
options, working directory, environment requirements, configuration variants,
outputs, prerequisites, and failure behavior. Find Nx imports in tool configs,
custom executors, scripts, and application code as well as CLI invocations.

## 2. Use Isox's project definition

For gradual migration, Isox can read existing Nx-schema `project.json` files
directly. A recognized Nx `$schema` preserves `targets` and triggers in-memory
conversion of `implicitDependencies` to `dependencies`. Options and custom
metadata survive; `$schema` becomes a file URL to the bundled Isox schema in the
converted workspace cache. Source files stay unchanged. Recognized schemas
include local `nx/schemas/project-schema.json` and legacy
`@nrwl/workspace/schemas/project-schema.json` paths, the project-configuration
identifier on `nx.dev`, and the official schema on `raw.githubusercontent.com`.
No schema is downloaded during discovery.

Migration is selected by `$schema`, not by field names alone. Files with no
schema or another schema are treated as Isox definitions with optional extra
metadata. A file defining both `implicitDependencies` and `dependencies` must be
resolved before automatic conversion. This does not resolve
inferred targets, target defaults, or targets using only shell-command shorthand;
targets without an `executor` are skipped in memory and in the workspace cache.
Commands still need explicit executor references and effective options.

Use this conversion to test existing executor-based projects before rewriting
their source files. For the final explicit Isox format, follow the steps below.

Keep the filename `project.json`. Run `isox init` at the workspace root to create
`isox.json` containing the installed CLI's version from its `package.json`, for
example `{ "version": "0.0.1" }`. When the root contains an `nx.json` file, init
also adds `"nx": { "executors": ["@nx"] }`. Init refuses to overwrite an existing file;
preserve and inspect any existing marker. Isox finds the nearest marker by walking
upward from the current directory. For existing markers, configure `nx.executors`
explicitly for any retained Nx executor scopes or packages.

Create or convert a `project.json` in each project's directory. Isox defines the
following fields and allows additional project and command properties for custom
executors and tools. Additional properties are preserved in the workspace cache
and executor context without giving them built-in scheduling behavior:

```json
{
  "$schema": "../../node_modules/@isox-sh/core/schemas/project.schema.json",
  "name": "cli",
  "dependencies": ["core"],
  "targets": {
    "build": {
      "executor": "@isox-sh/core:run-command",
      "options": {
        "command": "pnpm --filter @example/cli... build"
      }
    },
    "test": {
      "executor": "@isox-sh/core:run-command",
      "options": {
        "command": "pnpm --filter @example/cli test"
      }
    }
  },
  "tags": []
}
```

This example assumes a project two directories below the workspace root and a
pnpm package named `@example/cli`. Adapt the schema path, scripts, package names,
and commands to the repository. Verify that each referenced script actually
exists. The schema ships with `@isox-sh/core`; use the installed schema as the
source of truth if migrating against a different Isox version.

- Names must be unique and contain no whitespace or colons. An omitted name
  defaults to the containing directory's name. The project root is derived from
  the location of `project.json`; do not add a `root` field.
- Keep `targets`. A command requires `executor` and accepts optional
  `options` plus additional metadata. Executors use `package:executor` references; options must be objects.
- Convert manual dependencies to explicit Isox project names in `dependencies`.
  Resolve any Nx patterns and exclusions before converting them. Isox also infers
  relationships from source imports, TypeScript aliases, and local package
  references. Preserve relationships that cannot be inferred as explicit entries.
  These edges propagate affected changes; they do not schedule prerequisites.
- Preserve applicable string `tags`. Neither tags nor dependencies enforce
  module boundaries or schedule commands.
- Keep extra fields such as `sourceRoot`, `projectType`, or custom metadata when
  consumers need them. The Nx adapter passes explicit project metadata through.
  Migrate `implicitDependencies` to `dependencies` for Isox's own model, and
  replace Nx `$schema` references with the Isox schema.
- Preserve `configurations` as a map of names to option objects and optional
  `defaultConfiguration` as a name. Isox merges the selected configuration over
  base `options` at the top level; nested objects and arrays are replaced.
  Use `--prod` for `production`, or `--config=<name>` (`--configuration` and `-c`
  are aliases). An explicit name takes precedence over `--prod`, then the command's
  default is used. Missing configurations fail. Selection never rewrites the cache.
- Extra command fields such as `dependsOn`, `inputs`, `outputs`, or `cache` are
  allowed and preserved, but Isox does not implement their Nx orchestration
  behavior. Resolve workspace target defaults explicitly before migration.

## 3. Choose an execution path per command

Use native tools or native Isox executors as the final execution path. Retaining
an Nx 23-compatible executor through the adapter is supported only during initial
migration; verify it and record the work needed to replace it.

### Native shell commands

Use `@isox-sh/core:run-command` to invoke the repository's underlying tools or
scripts. Its options are:

- `command`: one nonempty shell command string.
- `cwd`: optional working directory, relative to the workspace root or absolute.

The default directory is the workspace root. Environment variables and standard
streams are inherited. Nonzero exits and signal termination fail the command.
There is no automatic `.env` loading, Nx token interpolation, command array,
or parallel execution. Unknown CLI flags override executor options; they are not
appended to the shell command. Configuration selection flags are handled by Isox
itself. Preserve required environment and
tool flags explicitly. Do not translate `nx:run-commands` by copying its entire
options object.

Preserve dependency build order using the existing package manager or explicit
ordered scripts. For example, pnpm's `--filter package...` can include package
dependencies when those relationships exist in package manifests. Isox's own
`dependencies` list does not establish pnpm dependencies. Avoid recursion: an
Isox build command that invokes `pnpm build` must not invoke a script that calls
the same Isox build command again.

### Native TypeScript builds

Use `js:tsc` from `@isox-sh/js` for native TypeScript 7 builds. Keep output and
compiler settings in tsconfig; translate Nx `outputPath` to `compilerOptions.outDir`
relative to the tsconfig directory (or use an absolute path). Nx's `outputPath` is
workspace-relative: for `packages/web/tsconfig.build.json`, `dist/web` becomes
`../../dist/web` so the output location is preserved. Also translate
`rootDir` to the matching compiler option. Remove executor options such as
Nx `main` and `transformers`; unknown native options fail rather than being ignored.
`noEmitOnError` is always enabled. Emitting configs require a safe workspace-local
output directory. This executor does not schedule dependency builds.

Native asset patterns require a workspace-relative `input`, a `glob`, optional
output-relative `output`, and optional `ignore`. Cleanup removes only stale owned,
unchanged files and preserves unrelated output. Define `generatePackageJson: true`
explicitly when a distributable manifest is required; it defaults to false. A
source package.json is optional, but must include name/version when present.
Without one, generation uses the Isox project name and workspace version (or
`0.0.0`). Preserve source metadata rather than copying Nx package-generation
options verbatim. `generateExportsField` and
output-relative `additionalEntryPoints` can add exports. Existing exports are
validated and preserved. Runtime dependencies are inferred from source imports
and resolved against project, workspace, and local package versions. Computed
module names require explicit dependency metadata. Lockfile generation is not
supported.

For watch mode, add an Isox configuration containing `watch: true` and select it
with `--config=watch`. There is no standalone forwarded `--watch` CLI flag.
Rebuilds refresh tsconfig, assets, and package metadata; recoverable errors keep
the stream alive. Signal/cancellation closes the watcher and compiler children.
See [the JS executor contract](/docs/typescript) for exact defaults,
workspace version handling, cleanup restrictions, and watch sampling limits.

### Temporarily retained Nx 23 executors

Install `@isox-sh/nx` in the workspace to retain Nx executors during migration.
When `nx.json` exists, `isox init` adds the adapter to `package.json` as a dev
dependency matching the CLI version, preserving any existing version. Run the
workspace's package manager to install dependencies and update the lockfile.

Executor packages matching a scope or package name in `isox.json`'s `nx.executors`
array use the Nx adapter. Init includes `@nx` in that array when the root contains
`nx.json`, enabling references
such as:

```json
{
  "name": "shared",
  "targets": {
    "build": {
      "executor": "@nx/js:tsc",
      "options": {
        "main": "libs/shared/src/index.ts",
        "tsConfig": "libs/shared/tsconfig.lib.json",
        "outputPath": "dist/libs/shared"
      }
    }
  }
}
```

This illustrates the syntax, not a guarantee that every version of that plugin
runs with the available adapter. Resolve required options from the installed
plugin and the repository's original configuration, then run the command.

The adapter loads an `executors` manifest, with `builders` as a fallback. It
maps Isox commands/dependencies to Nx targets/implicitDependencies and supplies
basic root, project, target, verbosity, and project-configuration context. It
passes an optional JSON `nx.json` through as `nxJsonConfiguration` without
applying defaults. `projectGraph` supplies all discovered project nodes and
declared dependency edges. Applications map to `app` nodes and libraries to `lib`.
When no project type is explicit, the adapter uses inferred metadata and falls
back to `lib`. Dependencies must name projects explicitly; missing names cause an error.
When Nx is installed alongside the executor, its graph builder runs in an isolated
process with the daemon disabled, supplying inferred project/import dependencies,
npm `externalNodes`, and a refreshed Nx file dependency map. This is required for
webpack's generated package manifests and pruned lockfiles, including helper
dependencies such as `tslib`. Keep the workspace's installed Nx runtime and
lockfile while retaining these executors. Nx's own workspace data cache is
updated separately from `.isox`, even when Isox's project cache is reused.
Graph failures stop execution. Without Nx installed, the adapter can only supply
the explicit Isox graph, with no npm nodes.
`taskGraph` describes only the selected command, with no scheduled prerequisites,
computed outputs, or output caching. Use `projectGraph` for project dependency
traversal; a plugin requiring Nx's full task pipeline needs further migration.
Explicit
extra project and command properties override inferred metadata, including
`sourceRoot` when present. See the
[Nx context reference](https://nx.dev/docs/reference/devkit/ExecutorContext)
when assessing a plugin's context requirements.

The runner merges the command's selected configuration before invoking the
adapter and supplies `configurationName` in the Nx context. Task IDs include the
configuration and task targets carry it as `configuration`. The graph's target
options remain the base definition. The adapter does not run Nx orchestration,
infer tasks, apply workspace target defaults, validate executor schemas, or apply
schema defaults. Copy required defaults into each command's options or named
configurations. If a plugin depends on unavailable context or reads
Nx project files itself, replace it with the underlying tool or report the
specific missing capability. Do not claim compatibility from the package name
alone. For `nx:*`, `@nrwl/*`, or third-party Nx plugins, add the corresponding
package or scope (for example `nx`, `@nrwl`, or `@nx-extend/gcp`) to `nx.executors`.
An absent or empty array selects no Nx packages, including `@nx/*`.
Do not rename a package reference unless the corresponding package is installed
and its behavior has been checked.

During initial migration, keep dependencies and configuration still required by
retained plugins, including Nx 23 peer dependencies and config helpers. Once the
user adopts Isox, replace these integrations and remove the dependencies after
verifying the native replacements.

### Custom native executors

Rewrite custom executors to use the exported Isox `Executor<Options>` type.
They receive `(options, context)` with this native context:

| Field | Meaning |
| --- | --- |
| `workspaceRoot`, `projectRoot` | Absolute paths |
| `projectName`, `commandName` | Selected names |
| `configurationName` | Selected configuration, or `undefined` |
| `project`, `command` | Resolved project record and base command definition |
| `workspace` | Native graph with `projects` |
| `logger` | Invocation logger with debug/info/success/warn/error methods |
| `verbose` | Debug logging enabled |

Read merged configuration values from the executor's `options` argument.
`context.command` retains the base command definition, including its unmerged
`options` and named `configurations`; the project and workspace records also
remain unchanged by configuration selection.

Replace Nx context accesses explicitly. Native context has no `targetName`,
`targets`, `projectsConfigurations`, or `isVerbose`. Use the native project and
command records. Replace imports of Nx execution helpers with actual Isox/tool
behavior rather than keeping an accidental dependency on Nx scheduling.

An executor returns `{ success: boolean }`, a promise of that result, or an async
iterable of such results. Ordinary failed results, empty iterables, missing
results, and exceptions fail the command. Watch executors can yield
`{ success, continuous: true }`; failed continuous results are recoverable while
the stream continues. Honor `context.signal` and close resources on cancellation.
Export a CommonJS callable
function or a callable default export. Declare `"executors": "./executors.json"` in the
package manifest. The command manifest has this shape:

```json
{
  "executors": {
    "build": { "implementation": "./dist/executors/build/build.executor.js" }
  }
}
```

Implementation paths are relative to the executor manifest. Place native command
implementations in `src/executors/<name>/<name>.executor.ts`. Native executors
use `executors` manifests. Nx packages also use `executors` (or legacy `builders`)
manifests; `nx.executors` selects which packages receive the Nx context. Ensure the executor package's `package.json`
can be resolved from the workspace root, including under pnpm's dependency
isolation. Build local executor packages before invoking their compiled files.

## 4. Update entry points and dependencies

Install `isox` through the repository's package manager and update its existing
lockfile. Core is a CLI dependency; built-in commands use the CLI's copy when
core cannot be resolved from the workspace. Install `@isox-sh/core` directly only
for API/type imports, editor schema paths, or an intentional workspace override.
Do not invent an unpublished version
or mix package managers. For a local Isox checkout, bootstrap its compiled CLI
using `pnpm bootstrap` first. Add executor packages where resolution from
the workspace root works.

Change scripts, documentation, editor tasks, and CI from `nx run project:build`
to `isox build project` (or `isox run project:build`). The syntax is
`isox <command> <target>`, where target is a project name. `init`, `run`, `reset`,
`affected`, `plan`, and `run-many` are reserved; use `isox run project:reset` for
a project command named `reset`.

Replace `nx affected` and `nx run-many` workflows with `isox affected` and
`isox run-many`. Use `isox plan` and the native GitHub Actions to distribute exact
project lists across weighted workers. Follow the [affected and CI guide](/docs/affected-and-ci)
for Git selection, tags, named configurations, and pre/post stages. Prepare
prerequisite outputs explicitly in each worker; the graph does not schedule
dependency builds. Preserve required build ordering and coverage; do not silently
skip checks. Report unresolved needs for remote caching, generators beyond the
available project initializers, release tooling, module-boundary rules, watch
orchestration, or artifact transfer.

Remove unused Nx scripts, configuration, and dependencies only after checking
remaining imports, retained adapters, and working commands. Do not leave a shell
wrapper around `nx run` as the final claimed replacement for Nx orchestration.
When no Nx executors remain, remove the entries from `nx.executors` in
`isox.json`. If a workflow still requires Nx, label it as an explicit migration
gap and describe its native replacement plan.

## 5. Validate and report

Add `.isox/` to version-control ignores. Isox stores discovered project
configuration in `.isox/workspace.json`; this is not a task-output cache.
Run `isox reset` after changing project files. Reset removes the entire `.isox`
directory, and the next workspace scan recreates it. Never edit the cache to
substitute for a project-file migration.

Run the migrated build, test, and lint commands needed to match the baseline.
Check at least one invocation from a nested directory, prerequisite build order,
output locations, and failure exit codes. Verify retained Nx executors against
their installed versions; tests of the adapter alone cannot establish plugin
compatibility. Put any new tests inside the package they belong to, and follow
the repository's code style.

Summarize changed files, the Nx-to-Isox command mapping, checks run and results,
temporarily retained Nx dependencies and their replacement plans, and any
remaining behavior gaps.
Do not report completion for workflows that have not been migrated or verified.
