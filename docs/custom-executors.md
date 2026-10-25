# Custom executors and initializers

[Documentation index](README.md)

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
need to reuse them. Project initializers belong in `src/generators`, and tests
stay inside the owning package's `tests` directory.

Executor-only plugins do not need `src/index.ts` or package `main`/`types`
entries. These are repository conventions; external plugins can choose another
layout because Isox loads the paths declared in their manifests.

### Building and packaging schemas

TypeScript compilation does not copy standalone JSON schemas. Configure
[`js:tsc` assets](typescript.md) in the plugin's `project.json` to preserve their
paths under `dist`:

```json
{
  "name": "my-plugin",
  "executors": {
    "build": {
      "executor": "js:tsc",
      "options": {
        "tsConfig": "packages/my-plugin/tsconfig.json",
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
  "init": "./dist/generators/init.js",
  "files": ["dist", "executors.json"]
}
```

Omit `init` when the plugin has no initializer. Keep package-level workspace
schemas, such as core's `schemas/project.schema.json`, separate from executor
options schemas.

The layout above describes a plugin with a local `dist` directory. This
repository builds standalone packages into `<repository>/dist/<package>`; see
[repository build outputs](contributing.md#build-outputs) for workspace links,
package generation, and bootstrap behavior. In both layouts, executor schemas
are copied through the configured assets.

## Executor implementation

```typescript
import type { Executor } from '@isox-sh/core'

const build: Executor<{ outputDir: string }> = async (options, context) => {
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

The native [`js:tsc` executor](typescript.md) supports owned-output cleanup,
asset copying, optional package.json/exports generation, and watch configurations.
Use `isox build <project> --config=watch` with `watch: true` in that configuration.
The full contract and migration limits are documented in the
[TypeScript executor guide](typescript.md).

## Programmatic execution

For programmatic execution, call
`runExecutor(workspace, projectName, commandName, workspaceRoot, logger?, configurationName?)`.
The runner selects and merges options from the workspace configuration. Omit the
configuration name to use the command's default. `context.command` and the
workspace graph retain the unmerged command definition; the executor's first
argument contains the merged options. `runExecutor` accepts an optional
`AbortSignal` as its seventh argument.

## Executor resolution

First-party executor packages may omit the `@isox-sh/` prefix: `js:tsc` and
`core:run-command` are supported alongside their fully scoped names, as is
`vitest:test` and `eslint:lint`. Resolution first tries `@isox-sh/<name>`, then the unscoped name
if the first-party package cannot be found. This selects the Isox executor even
when the workspace also installs Vitest itself. Invalid manifests or missing
commands in the resolved package report errors without falling back.

See the [core API](core-api.md) for programmatic use, JSON helpers, logging,
and the built-in shell-command executor.

## Project initializers

Packages can also declare `"init": "./dist/generators/init.js"` in `package.json` to support
`isox init <package> <path>`. The module exports a function (directly or as its
default export) matching core's `ProjectInitializer` type. It receives options
such as `importPath` and a context containing `workspaceRoot`, `projectRoot`,
`projectName`, and `logger`. The CLI resolves the package from the existing
workspace, validates the destination and project name, and refreshes discovery.
The initializer creates the project files and updates any shared configuration.

## Testing plugins

Use [`@isox-sh/e2e`](../packages/e2e/README.md) to create temporary workspaces with
your built plugin packages linked in. Its `createWorkspace` API accepts package
names mapped to local directories and exposes `runIsox`, `runNode`, and `cleanup`.
It works with any test runner and reuses existing package installations without
running a package manager. See the package guide for examples and supported
installation layouts.
