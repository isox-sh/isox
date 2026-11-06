---
title: "Workspace and project configuration"
description: "Configure isox.json, choose the base branch, and share target defaults."
sidebarTitle: "Configuration"
icon: "sliders"
---

## Workspace root

Run `isox init` at the workspace root to create `isox.json`. The file records the
installed CLI's version; an existing marker containing only `{}` also works.
Init writes to the current directory and refuses to overwrite an existing marker.

The CLI searches upward for the nearest `isox.json`, then discovers projects and
resolves plugins from that directory. Commands work from nested project directories
too. `isox.json` and `project.json` use JSON; TypeScript configs may use JSONC.

## isox.json reference

All workspace fields are optional; `{}` is a valid workspace marker. The table
lists every built-in field, including nested options. Defaults describe behavior
when a field is omitted. `isox init` writes the CLI version and the default
named input (`{projectRoot}/**/*`) into new workspaces.

| Field | Type | Default and behavior |
| --- | --- | --- |
| `$schema` | string | Optional editor schema URL or path. Use `./node_modules/@isox-sh/core/schemas/isox.schema.json` when core is installed directly. Validation uses the bundled schema regardless. |
| `version` | string | Informational CLI version written by `isox init`. Optional; it does not select a configuration format or pin the running CLI. |
| `affected` | object | Optional settings for Git-based project selection. |
| `affected.defaultBase` | non-empty string | `origin/main`. Overridden by `--base` or `ISOX_BASE`; see [base selection](#default-base-branch). |
| `affected.globalFiles` | unique string array | `[]`. Additional workspace-relative glob patterns whose changes select every project. Built-in global files still apply. |
| `affected.ignoreFiles` | unique string array | `[]`. Workspace-relative glob patterns excluded before global-file and project matching. |
| `targetDefaults` | object | `{}`. Keys are target names or `package:executor` references. Values use the [target fields](/docs/project-configuration#target-reference), without requiring an executor. |
| `namedInputs` | object | `{}`. Keys name reusable arrays of [input entries](/docs/project-configuration#input-reference). Project definitions override workspace sets with the same name. |
| `nx` | object | Optional settings for the separately installed adapter. |
| `nx.executors` | string array | `[]`. Package names or scopes whose executors route through `@isox-sh/nx`; for example, `@nx` or `@vendor/plugin`. |

Workspace metadata outside these fields is allowed, but does not create new
configuration behavior. The `version` and `$schema` metadata fields do not change
runtime settings. Executor-specific settings belong inside a target's `options`.

This example combines workspace selection, shared inputs, and target defaults:

```json
{
  "$schema": "./node_modules/@isox-sh/core/schemas/isox.schema.json",
  "affected": {
    "defaultBase": "origin/main",
    "globalFiles": ["tools/config/**"],
    "ignoreFiles": ["**/*.md"]
  },
  "namedInputs": {
    "sharedGlobals": ["{workspaceRoot}/tools/config/**", "{workspaceRoot}/tools/*.mjs"],
    "default": ["{projectRoot}/**/*", "sharedGlobals"],
    "production": ["default", "!{projectRoot}/**/*.test.ts"]
  },
  "targetDefaults": {
    "build": {
      "dependsOn": ["^build"],
      "cache": true,
      "inputs": ["production", "^production"]
    }
  }
}
```

When `nx.json` is present, init adds `@nx` to `nx.executors` and adds
`@isox-sh/nx` to development dependencies, preserving an existing plugin version.
Run your package manager's install command afterward. See
[Nx migration](/docs/nx-migration) for the adapter's limits.

## Default base branch

Set `affected.defaultBase` in `isox.json` to choose the default comparison branch
for `isox affected` and `isox plan`:

```json
{
  "affected": {
    "defaultBase": "origin/develop"
  }
}
```

The base revision is selected from `--base`, then `ISOX_BASE`, then
`affected.defaultBase`, falling back to `origin/main`. The value can be any Git
revision, including a branch, tag, or commit. It must be a non-empty string.
The head still defaults to `ISOX_HEAD` or `HEAD`. `--all` bypasses Git selection.
The core `getGitChanges` API uses the same workspace setting and precedence for
its `base` option. GitHub Actions that supply an event-specific base keep using
that explicit revision.

## Target defaults

Use `targetDefaults` in `isox.json` to share target settings across projects:

```json
{
  "$schema": "./node_modules/@isox-sh/core/schemas/isox.schema.json",
  "targetDefaults": {
    "build": {
      "cache": true
    },
    "js:tsc": {
      "outputs": ["{workspaceRoot}/dist/{projectRoot}"],
      "options": {
        "generatePackageJson": true
      },
      "configurations": {
        "acc": { "clean": false }
      }
    },
    "vitest:test": {
      "cache": true
    }
  }
}
```

A project still declares each target and its `executor`. Defaults do not create
missing targets. Settings merge from least to most specific:

1. Target-name defaults, such as `build`.
2. Executor defaults, such as `js:tsc`.
3. The target in `project.json`.
4. The selected named configuration, for executor options.
5. CLI executor-option overrides.

`options` merge by property. `configurations` merge by configuration name and then
by option property, so projects can override one setting without losing the rest.
Nested option objects and arrays are replaced, not recursively merged or appended.
Other target fields are replaced, including `inputs` and `outputs`. Explicit
`false` and empty arrays are preserved. `defaultConfiguration` can be inherited.

First-party shorthand and scoped executor keys match each other: `js:tsc` also
applies to `@isox-sh/js:tsc`. If both keys exist, the spelling used by the target
wins conflicting values. Use one spelling per executor to keep settings clear.
Packages selected through `nx.executors` use their exact executor keys.

For native targets with `cache: true`, `outputs` is optional. When omitted after
merging, only the successful result and terminal logs are cached. Use `outputs: []`
to override inherited output directories with logs-only caching. Output paths must match the compiler/tool configuration. The example
matches the JS initializer's `dist/<project-root>` layout. For a `dist/<project-name>`
layout, use `"outputs": ["{workspaceRoot}/dist/{projectName}"]`. Override `outputs`
in any project with a different layout. See [task caching](/docs/task-caching)
for disposable-directory ownership and input declarations.

Isox merges `targetDefaults` during workspace discovery and stores the effective
targets in `.isox/workspace.json`. Cached lookups reuse those targets directly.
After changing defaults, run `isox reset` before a single-project command, or use
a command that refreshes discovery (`affected`, `plan`, or `run-many`). Project
definitions and defaults follow the same refresh rules.

Each defaults entry must be an object. Define `namedInputs` at the workspace or
project level, and reference those sets from a target's `inputs`. Custom metadata
is allowed, but does not create additional matching or merging rules.

## Project definitions

See [Project definitions](/docs/project-configuration#project-definitions).

### project.json reference

See [project.json reference](/docs/project-configuration#project-definitions).

## Target reference

See [Target reference](/docs/project-configuration#target-reference).

## Input reference

See [Input reference](/docs/project-configuration#input-reference).

## Discovery boundaries

See [Discovery boundaries](/docs/project-discovery#discovery-boundaries).

## Dependency discovery

See [Dependency discovery](/docs/project-discovery#dependency-discovery).

## CI selection

See [CI selection](/docs/project-discovery#ci-selection).

## Discovery cache

See [Discovery cache](/docs/discovery-cache#discovery-cache).

### Project definitions

See [Project definitions](/docs/project-configuration#project-definitions).

### On-demand dependency analysis

See [On-demand dependency analysis](/docs/discovery-cache#on-demand-dependency-analysis).

### What the sources SHA means

See [What the sources SHA means](/docs/discovery-cache#what-the-sources-sha-means).

### What the reads entries mean

See [What the reads entries mean](/docs/discovery-cache#what-the-reads-entries-mean).

### Reset and recovery

See [Reset and recovery](/docs/discovery-cache#reset-and-recovery).

## Task prerequisites

See [Task prerequisites](/docs/task-prerequisites#task-prerequisites).

### Same-project and dependency builds

See [Same-project and dependency builds](/docs/task-prerequisites#same-project-and-dependency-builds).

### Expanded entries and forwarded options

See [Expanded entries and forwarded options](/docs/task-prerequisites#expanded-entries-and-forwarded-options).

### Scheduling and configuration

See [Scheduling and configuration](/docs/task-prerequisites#scheduling-and-configuration).
