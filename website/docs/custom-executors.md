---
title: "Custom executors and initializers"
description: "Build native plugins with executor manifests, project initializers, continuous results, and cancellation."
sidebarTitle: "Custom plugins"
icon: "puzzle-piece"
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

## Plugin layout

Use this layout for executor plugins in this repository:

```text
packages/<plugin>/
├── package.json
├── executors.json
├── generators.json
├── project.json
├── src/
│   ├── executors/
│   │   └── lint/
│   │       ├── lint.executor.ts
│   │       └── lint.schema.json
│   ├── generators/
│   │   └── init.ts
│   └── helpers/
└── tests/
```

Each executor lives in `src/executors/<name>/`. Name its implementation
`<name>.executor.ts` and keep its options schema beside it as
`<name>.schema.json`. For example, ESLint uses `lint.executor.ts` and
`lint.schema.json`; TypeScript uses `tsc.executor.ts` and `tsc.schema.json`.
Keep executor-specific helpers in the same folder. Shared plugin helpers belong
in `src/helpers`; export them through package entry points when other plugins
need to reuse them. Project initializers and add generators belong in `src/generators`, and tests
stay inside the owning package's `tests` directory.

Executor-only plugins do not need `src/index.ts` or package `main`/`types`
entries. These are repository conventions; external plugins can choose another
layout because Isox loads the paths declared in their manifests.

### Building and packaging schemas

TypeScript compilation does not copy standalone JSON schemas. Configure
[`js:tsc` assets](/docs/typescript) in the plugin's `project.json` to preserve their
paths under `dist`:

```json
{
  "name": "my-plugin",
  "targets": {
    "build": {
      "executor": "js:tsc",
      "options": {
        "tsConfig": "packages/my-plugin/tsconfig.build.json",
        "assets": [
          {
            "input": "packages/my-plugin/src",
            "glob": "executors/**/*.schema.json"
          }
        ]
      }
    }
  }
}
```

With `rootDir: "./src"` and `outDir: "./dist"` in the package's tsconfig, this
produces `dist/executors/lint/lint.executor.js` and
`dist/executors/lint/lint.schema.json`. Copy any supporting JSON files referenced
by a schema as assets too, preserving their relative paths.

Point both manifest fields at the built files:

```json
{
  "executors": {
    "lint": {
      "implementation": "./dist/executors/lint/lint.executor.js",
      "schema": "./dist/executors/lint/lint.schema.json"
    }
  }
}
```

Publish the build directory and manifest using these `package.json` fields:

```json
{
  "executors": "./executors.json",
  "generators": "./generators.json",
  "files": ["dist", "executors.json", "generators.json"]
}
```

Omit `generators` when the plugin has no generators. Keep package-level workspace
schemas, such as core's `schemas/project.schema.json`, separate from executor
options schemas.

The layout above describes a plugin with a local `dist` directory. This
repository builds standalone packages into `<repository>/dist/<package>`; see
[repository build outputs](/docs/contributing#build-outputs) for workspace links,
package generation, and bootstrap behavior. In both layouts, executor schemas
are copied through the configured assets.

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
`runExecutor(workspace, projectName, commandName, workspaceRoot, logger?, configurationName?, signal?, optionOverrides?)`.
The runner selects and merges options from the workspace configuration. Omit the
configuration name to use the command's default. `context.command` and the
workspace graph retain the unmerged command definition; the executor's first
argument contains the merged options. `runExecutor` accepts an optional
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

## Project initializers

Declare `"generators": "./generators.json"` in `package.json`, alongside the
`executors` registry. The `generators.json` file maps generator names to their
implementations:

```json
{
  "generators": {
    "init": {
      "implementation": "./dist/generators/init.js",
      "description": "Create a project."
    },
    "add": {
      "implementation": "./dist/generators/add.js",
      "description": "Configure an existing project."
    }
  }
}
```

Paths are relative to `generators.json`. Include only the generators your plugin
provides. Move former top-level `init` and `add` package fields into this registry;
those package fields are no longer used. The CLI currently invokes `init` through
`isox init <package> <path>` and `add` through `isox add <package> <project>`.
Additional names can be recorded for future generators but have no CLI command yet.

The `init` module exports a function (directly or as its
default export) matching core's `ProjectInitializer` type. It receives options
such as `importPath` and a context containing `workspaceRoot`, `projectRoot`,
`projectName`, and `logger`. The CLI resolves the package from the existing
workspace, validates the destination and project name, and refreshes discovery.
The initializer creates the project files and updates any shared configuration.

## Adding plugins to existing projects

Declare an `add` entry in the plugin's `generators.json` to support
`isox add <package> <project>`. Keep its implementation in `src/generators/add.ts`.
The exported function implements core's `ProjectAdder` type:

```typescript
import type { ProjectAdder } from '@isox-sh/core'

const add: ProjectAdder = async (_options, context) => {
  // Read the existing configuration and add the plugin's targets.
  context.logger.info(`Configuring ${context.projectName}`)
}

export default add
```

It receives an empty options object and the same context fields as an initializer:
`workspaceRoot`, `projectRoot`, `projectName`, and `logger`. The CLI looks up
the project by name in fresh workspace discovery and resolves its directory.
Root projects use their project name as well. The command works from any directory
inside the workspace. The CLI resolves the installed package and invalidates only workspace
discovery after invocation, including on generator failure. Other cache files
remain intact.

Generators own their edits and should preserve existing configuration, handle
repeat calls, and reject conflicting targets. The release plugin supplies an
example: `isox add @isox-sh/semver my-package` adds its `version` target.
The TypeScript package builder copies `generators.json` and rewrites all
implementation and optional schema paths into the published output. Generator
schemas are metadata; the CLI does not apply schema validation or defaults.

## Testing plugins

Use [`@isox-sh/e2e`](/docs/plugin-testing) to create temporary workspaces with
your built plugin packages linked in. Its `createWorkspace` API accepts package
names mapped to local directories and exposes `runIsox`, `runNode`, and `cleanup`.
It works with any test runner and reuses existing package installations without
running a package manager. See the package guide for examples and supported
installation layouts.
