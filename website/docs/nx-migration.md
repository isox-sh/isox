---
title: "Migrating from Nx"
description: "Convert Nx projects to native Isox commands with temporary adapter support for Nx 23."
sidebarTitle: "Migrate from Nx"
icon: "arrow-right-arrow-left"
---

The adapter is provided by the separate `@isox-sh/nx` plugin. Requires Node.js 24+.
Install it in the workspace alongside your retained Nx executor packages:

```sh
npm install --save-dev @isox-sh/nx
```

When `nx.json` exists, `isox init` configures Nx selection and adds the plugin to
`package.json`. Run your package manager's install command to install it. For an existing workspace marker, install the plugin manually and add the
selection below. Native commands do not require it.

**Only Nx 23 is supported.** Nx integration is temporary support for initial
migration and evaluation. Other Nx versions are unsupported. Once you decide to
adopt Isox, replace retained Nx executors with native Isox executors or
`@isox-sh/core:run-command` invocations of the underlying tools. Migrate Nx config
helpers and defaults as well, then remove unused Nx packages and configuration
and clear `nx.executors`. Retaining the adapter is an incomplete migration.

## Selecting executors

When the workspace root contains `nx.json`, `isox init` includes `@nx` in
`nx.executors`, so executors such as `@nx/js:tsc` use the separate Nx adapter.
Project files still use Isox's `targets` and `dependencies`. To always use the Nx
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
Matching packages use the Nx adapter. Other packages use the native contract.
Both read `executors` manifests; Nx also accepts legacy `builders` manifests. Changes to `isox.json` take
effect on the next run without `isox reset`.

## Executor context and graph

The adapter accepts an `executors` manifest, falling back to `builders`, and
supplies `root`, `cwd`, `projectName`, `targetName`, `configurationName`, `target`, `isVerbose`,
`projectsConfigurations`, `projectGraph`, `taskGraph`, and the legacy `workspace` alias. Project commands and
dependencies become `targets` and `implicitDependencies` in that context.

`projectGraph.nodes` contains every discovered project and its complete adapted
configuration. Applications use node type `app`; libraries use `lib`. Without an
explicit `projectType`, inferred metadata determines the type, defaulting to
`lib` when unavailable. Declared project dependencies become `implicit` graph
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
Cancelling during graph generation stops the worker without starting the executor.

Without an installed Nx runtime, only Isox-discovered nodes and dependencies are
available. An installed Nx runtime outside version 23 is rejected before graph
construction. If graph construction fails, Isox reports the
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

## Project conversion

When `$schema` references Nx's project schema, discovery keeps the `targets` field
and converts `implicitDependencies` to `dependencies` in memory. It preserves
options and additional metadata and replaces `$schema` with a file URL to the
bundled Isox schema. The converted graph is written to `.isox/workspace.json`;
the original `project.json` is never modified. Recognized references include
local `nx/schemas/project-schema.json` and legacy
`@nrwl/workspace/schemas/project-schema.json` paths, Nx's project-configuration
schema identifier on `nx.dev`, and the schema in the official raw GitHub repository.
Files with another schema or no schema retain their fields as written. A file
that defines both `implicitDependencies` and `dependencies`
reports an error instead of discarding either value.

This conversion covers explicitly configured targets with an `executor`;
inferred targets, target defaults, and shell-command shorthand are not resolved.
Targets without an `executor` are skipped in memory and in the workspace cache.
Commands execute through the resulting `targets` field. Extra metadata
does not automatically enable `dependsOn` scheduling, `inputs`, or `outputs`
processing. The resolved `name` and file-derived `root`
remain authoritative in the workspace graph.

## Retaining an Nx executor

Keep the original executor reference in `project.json`:

```json
{
  "name": "web",
  "targets": {
    "build": {
      "executor": "@nx/js:tsc",
      "options": {
        "main": "apps/web/src/index.ts",
        "tsConfig": "apps/web/tsconfig.json",
        "outputPath": "dist/apps/web"
      }
    }
  }
}
```

Run `isox build web` as usual. See the
[AI migration prompt](/docs/prompts/migrate-nx-to-isox) for a complete migration checklist.
