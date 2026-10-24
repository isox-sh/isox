<div align="center">
  <img src="./.github/assets/banner.svg" alt="Isox Banner" width="100%" />

  <br />
  <p><b>A lightweight monorepo command runner with explicit project configuration.</b></p>

  [![npm version](https://img.shields.io/npm/v/@isox-sh/cli.svg?style=flat-square&color=3b82f6)](https://npmjs.com/package/@isox-sh/cli)
  [![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg?style=flat-square)](https://opensource.org/licenses/MIT)
  [![Website](https://img.shields.io/badge/Website-isox.sh-blue.svg?style=flat-square)](https://isox.sh)
  [![CI](https://img.shields.io/github/actions/workflow/status/isox-sh/isox/ci.yml?style=flat-square&logo=github)](https://github.com/isox-sh/isox/actions)
</div>

<hr />

## What is Isox?

Isox discovers projects and runs their commands. Each project has its own
`project.json` containing `name`, `dependencies`, `commands`, and `tags`.
An `isox.json` marker identifies the workspace root, and a local discovery cache
keeps subsequent runs fast. No background daemon is required.

Native executors receive Isox's own context. Executors selected by `nx.executors` use a
separate adapter that supports **Nx 23 only**, solely for initial migration.
If you decide to keep using Isox, migrate remaining Nx executors and configuration
to native Isox commands and the underlying tools. Isox does not implement Nx's
configuration model or task scheduler. See the
[AI migration prompt](docs/prompts/migrate-nx-to-isox.md) for the migration steps.

```bash
isox init
isox build my-app
isox test my-app --verbose
isox run my-app:build
isox reset
```

The current implementation runs one project's command at a time. Dependency
scheduling, affected detection, `run-many`, task output caching, isolation, and
distributed execution are not implemented. `dependencies` and `tags` are metadata;
use underlying tools or package-manager scripts for dependency build ordering.

---

## 🤝 Contributing

We are actively building out the core engine. Check out the [Issues](https://github.com/isox-sh/isox/issues) page to see the roadmap, or submit a PR!

Use Node.js 20.19+, 22.13+, or 24+ for the CLI and development tools.
The repository uses pnpm workspaces, with packages under `packages/`. Install
[pnpm](https://pnpm.io/installation) using the version pinned in `package.json`,
then run `pnpm install` from the repository root. Commit changes to
`pnpm-lock.yaml` alongside dependency updates; use `pnpm install --frozen-lockfile`
in CI.

Builds use TypeScript 7 (`tsc`), installed as `@typescript/native`. The
`typescript` dependency aliases Microsoft's TypeScript 6 compatibility package
for ESLint's compiler API requirements. This follows the
[TypeScript 7 migration guidance](https://devblogs.microsoft.com/typescript/announcing-typescript-7-0/#running-side-by-side-with-typescript-6-0).

```bash
pnpm install
pnpm build # Compiles core before CLI
pnpm lint # Checks JavaScript and TypeScript, including import sorting and no semicolons
pnpm lint:fix # Automatically fixes supported lint issues
pnpm test  # Builds and runs the integration tests
```

Tests live in their owning package's `tests/` directory. `pnpm test` builds the
workspace and runs both package suites; after building, use
`pnpm --filter @isox-sh/core test` or `pnpm --filter @isox-sh/cli test` for one suite.

Both packages have Isox `project.json` files with `build`, `lint`, and `test` commands.
Run `pnpm build` once to bootstrap the local CLI, then use Isox itself:

```bash
pnpm isox build core
pnpm isox build cli
pnpm isox lint core
pnpm isox lint cli
pnpm isox test core
pnpm isox test cli
```

The syntax is `isox <command> <target>`, where target is the project's name.
Any command defined in that project's `commands` object can be used.
`isox run cli:build` also works. `init`, `run`, and `reset` are reserved CLI commands;
use `isox run <project>:<command>` for project commands with those names.

These commands use the bundled `@isox-sh/core:run-command` executor. The CLI build
command uses pnpm's dependency filter to build core first; Isox records
`dependencies` but does not schedule them yet. The root `build` script
remains available to bootstrap from a clean checkout. After editing a
`project.json`, use `pnpm isox reset` to refresh discovery on the next run.

The project definition uses `name`, `dependencies` (project names), `commands`,
and `tags`. Each command specifies an `executor`, optional `options`, and optional
`configurations` and `defaultConfiguration`. The
project root comes from the file's location; an omitted name defaults to that
directory's name. Dependencies and tags are optional. For example:

```json
{
  "$schema": "../core/schemas/project.schema.json",
  "name": "cli",
  "dependencies": ["core"],
  "commands": {
    "build": {
      "executor": "@isox-sh/core:run-command",
      "options": {
        "command": "pnpm --filter @isox-sh/cli... build"
      }
    }
  },
  "tags": []
}
```

The schema is shipped at `@isox-sh/core/schemas/project.schema.json`; set `$schema`
to its relative path for editor validation and completion. Isox validates files
against the same schema when discovering projects. Core also exports the
`ProjectDefinition` and `CommandConfiguration` TypeScript types. The example
above uses the schema path for `packages/cli` in this repository.

Project and command objects allow additional properties for use by custom
executors and other tools. Isox preserves them in the workspace cache and executor
context: read them through `context.project` and `context.command`. The exported
TypeScript interfaces expose additional fields as `unknown`, so consumers can
narrow them to their own types. Defined Isox fields are still validated.

When `$schema` references Nx's project schema, discovery converts `targets` to
`commands` and `implicitDependencies` to `dependencies` in memory. It preserves
options and additional metadata and replaces `$schema` with a file URL to the
bundled Isox schema. The converted graph is written to `.isox/workspace.json`;
the original `project.json` is never modified. Recognized references include
local `nx/schemas/project-schema.json` and legacy
`@nrwl/workspace/schemas/project-schema.json` paths, Nx's project-configuration
schema identifier on `nx.dev`, and the schema in the official raw GitHub repository.
Files with another schema or no schema retain their fields as written. A file
that defines both names of a mapped field (such as `targets` and `commands`)
reports an error instead of discarding either value.

This conversion covers explicitly configured targets with an `executor`;
inferred targets, target defaults, and shell-command shorthand are not resolved.
Commands execute through the resulting `commands` field. Extra metadata
does not automatically enable `dependsOn` scheduling, `inputs`, or `outputs`
processing. The resolved `name` and file-derived `root`
remain authoritative in the workspace graph.

Run `isox init` at the root of a new workspace to create `isox.json` containing
`{ "version": "0.0.1" }` with the version read from the installed CLI's
`package.json`. If that directory contains an `nx.json` file, init also adds
`"nx": { "executors": ["@nx"] }`. Init writes to the current directory and refuses to
overwrite an existing file. Existing unversioned markers still work. The CLI
searches the current directory and its parents for the nearest `isox.json` file.
It discovers projects, resolves plugins, and runs executors from that directory,
so commands work from nested project directories too. A missing marker produces
an error. The file also supports `nx.executors` to select additional packages
that use the Nx executor adapter.

The first workspace scan saves all discovered project configurations, including
commands, options, and dependencies, to `.isox/workspace.json`. Later
runs read this cache without scanning project files. After adding, removing, or
editing projects, run `isox reset` from anywhere in the workspace to remove the
entire `.isox` directory. The next run recreates the cache. Invalid or outdated
cache files are rebuilt automatically. Keep `.isox/` out of version control.

To try the local CLI, run it from a workspace containing `isox.json`,
`project.json` files, and installed executor plugins:

```bash
cd /path/to/your/workspace
node /path/to/isox/packages/cli/dist/index.js build my-app
```

### Named configurations

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
options are used. An unknown configuration fails with an error.

Options are merged at the top level: `{ ...options, ...configurations[name] }`.
Nested objects and arrays are replaced rather than recursively merged. This
works with native and Nx executors, including automatically migrated Nx project
files. The source configuration and workspace cache retain their original values;
the selected options are computed for each invocation. Only one configuration
can be selected per invocation. Other executor CLI flags are not forwarded.

### Native executors

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

```typescript
import type { Executor } from '@isox-sh/core'

const build: Executor<{ outputDir: string }> = async (options, context) => {
  context.logger.info(`Building ${context.projectName} into ${options.outputDir}`)
  // Run the build here, then report its result.
  return { success: true }
}

export default build
```

An executor package declares `"commands": "./commands.json"` in its
`package.json`. That manifest maps names to implementation paths relative to the
manifest file, for example:

```json
{
  "commands": {
    "build": { "implementation": "./dist/build.js" }
  }
}
```

Install the package where its `package.json` can be resolved from the workspace
root. The loader uses CommonJS `require` and accepts a callable module export or
its `default` export. Executors return `{ success: true }`, a promise of that
result, or an async iterable of results. A failed or missing result, an empty
iterable, or a thrown error fails the command. Options are passed through without
executor schema validation or schema defaults.

For programmatic execution, call
`runExecutor(workspace, projectName, commandName, workspaceRoot, logger?, configurationName?)`.
The runner selects and merges options from the workspace configuration. Omit the
configuration name to use the command's default. `context.command` and the
workspace graph retain the unmerged command definition; the executor's first
argument contains the merged options.

The bundled `@isox-sh/core:run-command` executor accepts `command` (a shell string)
and optional `cwd` (relative to the workspace root, or absolute). It inherits the
parent environment and standard streams. A nonzero exit or termination by a
signal fails the command. It does not substitute Nx tokens or schedule dependencies.

### Nx executor adapter

**Only Nx 23 is supported.** Nx integration is temporary support for initial
migration and evaluation. Other Nx versions are unsupported. Once you decide to
adopt Isox, replace retained Nx executors with native Isox executors or
`@isox-sh/core:run-command` invocations of the underlying tools. Migrate Nx config
helpers and defaults as well, then remove unused Nx packages and configuration
and clear `nx.executors`. Retaining the adapter is an incomplete migration.

When the workspace root contains `nx.json`, `isox init` includes `@nx` in
`nx.executors`, so executors such as `@nx/js:tsc` use the separate Nx adapter.
Project files still use Isox's `commands` and `dependencies`. To always use the Nx
adapter for additional scopes or packages, configure `nx.executors` in `isox.json`:

```json
{
  "nx": {
    "executors": ["@nx", "@nx-extend", "@nrwl/js"]
  }
}
```

`@nx-extend` matches every package in that scope. To enable only its GCP package,
use `@nx-extend/gcp` instead. Package entries match exactly, and unscoped package
names are supported too. Runner selection uses only this array, including for
`@nx/*` packages. An absent or empty array selects no Nx packages.
Matching packages always use the Nx adapter, even if they also expose native
commands. Other packages use the native contract. Changes to `isox.json` take
effect on the next run without `isox reset`.

The adapter accepts an `executors` manifest, falling back to `builders`, and
supplies `root`, `cwd`, `projectName`, `targetName`, `configurationName`, `target`, `isVerbose`,
`projectsConfigurations`, `projectGraph`, `taskGraph`, and the legacy `workspace` alias. Project commands and
dependencies become `targets` and `implicitDependencies` in that context.

`projectGraph.nodes` contains every discovered project and its complete adapted
configuration. Applications use node type `app`; libraries and projects without
`projectType` use `lib`. Declared project dependencies become `implicit` graph
edges unless Nx already supplies an edge to the same project. Missing dependency
names produce a descriptive error.

When Nx 23 is installed alongside the executor, the adapter uses that installation
to refresh its project graph and file dependency map. This supplies inferred
project/import dependencies and npm `externalNodes`, including helper packages
such as `tslib`, for webpack package generation and lockfile pruning. Isox's
explicit project configuration and command options remain authoritative.
Graph generation runs in a separate process with the Nx daemon disabled; it
updates Nx's own workspace data cache (normally `.nx/workspace-data`). It runs
even when `.isox/workspace.json` is cached, so source and lockfile changes are
checked. `isox reset` still removes only `.isox`.

Without an installed Nx runtime, only explicit Isox nodes and dependencies are
available. If Nx is installed but graph construction fails, Isox reports the
failure before running the executor rather than supplying an incomplete graph.

`taskGraph` describes the single command being executed, including its target,
project root, selected configuration, and empty dependency lists. Configured
task IDs use `project:command:configuration`. It does not schedule prerequisites or
compute task outputs and hashes; its task has `outputs: []` and `cache: false`.
Project dependency edges remain available through `projectGraph`.

The adapter reads an optional JSON `nx.json` into `nxJsonConfiguration` (or uses
`{}` when absent). Command configurations are merged before invoking the adapter.
It does not apply workspace target defaults or executor schema defaults to the
options passed to the executor. Nx-inferred metadata supplements the graph;
explicit extra project and command properties are passed through, including
`sourceRoot` when provided. Plugins that require missing features need migration or additional
adapter support. Test each retained plugin against its installed version; this adapter is not a claim
of drop-in compatibility. The native runner does not read `nx.json`.

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

1. Fork the repo
2. Create your feature branch (`git checkout -b feature/amazing-feature`)
3. Commit your changes (`git commit -m 'Add amazing feature'`)
4. Push to the branch (`git push origin feature/amazing-feature`)
5. Open a Pull Request

## 📝 License

Distributed under the [MIT License](https://opensource.org/licenses/MIT). See `LICENSE` for more information.
