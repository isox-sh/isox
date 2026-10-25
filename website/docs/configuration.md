---
title: "Workspace and project configuration"
description: "Configure workspace roots, project definitions, dependency discovery, schemas, and caching."
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

| Workspace setting | Purpose |
| --- | --- |
| `affected.defaultBase` | Default Git revision for affected selection; defaults to `origin/main` |
| `affected.globalFiles` | Additional workspace-relative globs whose changes affect all projects |
| `affected.ignoreFiles` | Globs excluded before global-file and project matching |
| `nx.executors` | Package names or scopes routed through the optional Nx adapter |

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

## Project definitions

Each project has a `project.json`. Its location determines the project root.
The entries under `targets` are the commands you can run with Isox:

```json
{
  "$schema": "../../node_modules/@isox-sh/core/schemas/project.schema.json",
  "name": "web",
  "plan": { "weight": 3 },
  "targets": {
    "build": {
      "executor": "js:tsc",
      "options": {
        "tsConfig": "apps/web/tsconfig.build.json"
      }
    }
  },
  "tags": ["type=frontend"]
}
```

This example belongs in `apps/web/project.json` and requires `@isox-sh/js`.
Install `@isox-sh/core` directly to use the shown editor schema path, or omit
`$schema`. Isox validates project definitions against its bundled schema either way.

| Project field | Purpose |
| --- | --- |
| `name` | Unique project name; defaults to the containing directory name |
| `targets` | Named commands, each with a required `executor` reference |
| `dependencies` | Additional Isox project names, merged with inferred dependencies |
| `tags` | Labels for selection, such as `type=frontend` |
| `plan.enabled` | Include in automatic selection; defaults to `true` |
| `plan.weight` | Positive relative cost for CI distribution; defaults to `1` |

All these project fields are optional. Names must contain no whitespace or colons.
Each target can define `options`, `configurations`, and `defaultConfiguration`.
Core exports `ProjectDefinition` and `ExecutorConfiguration` TypeScript types.

Projects using the former `executors` field should rename it to `targets`.
Plugin `executors.json` registries and `nx.executors` settings keep their names.

Project and command objects allow additional properties for use by custom
executors and other tools. Isox preserves them in the workspace cache and executor
context: read them through `context.project` and `context.command`. The exported
TypeScript interfaces expose additional fields as `unknown`, so consumers can
narrow them to their own types. Defined Isox fields are still validated.

See [named configurations](/docs/cli#named-configurations) for option overrides and
[Nx project conversion](/docs/nx-migration#project-conversion) for existing Nx files.

## Dependency discovery

TypeScript configs are optional. Projects without them still participate in
discovery through package manifests, imports, and explicit dependencies.

Discovery detects project dependencies from TypeScript/JavaScript imports,
re-exports, literal dynamic imports and require calls, including type-only imports
and test files. Package names and subpaths map to their owning projects. Relative
cross-project imports and exact or wildcard TypeScript `paths` aliases also count;
extended configs and project-specific overrides are respected. Aliases can point
to source files or declared compiler output directories, even before a build.
Output ownership uses the build target's `options.tsConfig`, including its default
configuration and inherited `outDir`, `declarationDir`, and `rootDir`. When that
option is absent or its file does not exist, discovery uses the project's
`tsconfig.json`, then the workspace's `tsconfig.base.json` or `tsconfig.json`.
Source aliases use the project or shared editor config. Existing malformed
configs produce an error; no config is required for a plain JavaScript project.

Local package references in `dependencies`, `devDependencies`, `optionalDependencies`,
and `peerDependencies` are also detected. Package aliases and relative workspace
references are supported. Duplicate workspace package names fail discovery.

Use `project.json`'s optional `dependencies` for additional project names that
cannot be inferred, such as dynamically selected plugins or generated inputs.
These are merged with detected dependencies in `.isox/workspace.json`; source
project files stay unchanged. Comments, ordinary strings, Node builtins, self-imports,
dependency folders and recognized output directories are excluded. Generated files
outside the ignored paths and configured output directories are still scanned.
Merely listing a command's executor does not add an edge. Affected planning
rejects unknown dependencies and reports dependency cycles. See
[cycle troubleshooting](/docs/troubleshooting#project-dependency-cycle) when a
root project or test imports introduce unexpected relationships.

## CI selection

Set `plan.enabled` to `false` to exclude a project from `affected`, `plan`, and
ordinary `run-many` selection. It defaults to `true`. Direct commands and exact
`run-many --projects-json` lists can still run it, and changes still affect its
dependents. The existing `ci=off` tag also excludes projects, even when
`plan.enabled` is `true`.

`plan.weight` is a positive number that estimates a project's relative CI cost.
It defaults to `1`; increasing it gives the project more weight when balancing
shards. Fractional weights are supported. See [affected and CI](/docs/affected-and-ci)
for tag filters, distribution, and workspace-relative `affected.globalFiles` and
`affected.ignoreFiles` globs in `isox.json`. Global files select every project;
ignored files are excluded first. Other files outside any project do not affect
selection by default.

## Discovery cache

The first workspace scan saves all discovered project configurations, including
commands, options, and dependencies, to `.isox/workspace.json`. Later
runs of single-project commands read this cache without scanning project files. After adding, removing, or
editing projects, run `isox reset` from anywhere in the workspace to remove the
entire `.isox` directory. The next run recreates the cache. Invalid or outdated
cache files are rebuilt automatically. Keep `.isox/` out of version control.

`affected`, `plan`, and `run-many` always read current project files and refresh
the cache so branch changes and changed weights cannot produce stale plans.

Project initialization refreshes discovery automatically. `isox add` invalidates
the discovery cache after running a generator. See
[getting started](/docs/getting-started#define-a-project) to create a project.

Reset also removes TypeScript output ownership records and locks. Stop active
builds first; existing output files remain, but later builds can no longer clean
stale files tracked only by the removed records. See
[TypeScript state files](/docs/typescript#typescript-state-files) for their purpose.
