---
title: "Workspace and project configuration"
description: "Configure workspace roots, project definitions, dependency discovery, schemas, and caching."
sidebarTitle: "Configuration"
icon: "sliders"
---

## Workspace root

Run `isox init` at the root of a new workspace to create `isox.json` containing
`{ "version": "0.0.1" }` with the version read from the installed CLI's
`package.json`. If that directory contains an `nx.json` file, init also adds
`"nx": { "executors": ["@nx"] }` and adds `@isox-sh/nx` to `package.json` as a
dev dependency matching the CLI version, preserving any existing plugin version.
Run your package manager's install command afterward. Init writes to the current
directory and refuses to overwrite an existing `isox.json`. Existing unversioned markers still work. The CLI
searches the current directory and its parents for the nearest `isox.json` file.
It discovers projects, resolves plugins, and runs executors from that directory,
so commands work from nested project directories too. A missing marker produces
an error. The file also supports `nx.executors` to select additional packages
that use the Nx executor adapter.

## Project definitions

The project definition uses `name`, `dependencies` (project names), `executors`,
`tags`, and optional `plan.weight`. Each command specifies an `executor`, optional `options`, and optional
`configurations` and `defaultConfiguration`. The
project root comes from the file's location; an omitted name defaults to that
directory's name. Dependencies and tags are optional. For example:

```json
{
  "$schema": "../core/schemas/project.schema.json",
  "name": "cli",
  "dependencies": ["core"],
  "plan": { "weight": 3 },
  "executors": {
    "build": {
      "executor": "js:tsc",
      "options": {
        "tsConfig": "packages/cli/tsconfig.json"
      }
    }
  },
  "tags": []
}
```

The schema is shipped at `@isox-sh/core/schemas/project.schema.json`; set `$schema`
to its relative path for editor validation and completion. Isox validates files
against the same schema when discovering projects. Core also exports the
`ProjectDefinition` and `ExecutorConfiguration` TypeScript types. The example
above uses the schema path for `packages/cli` in this repository.

Project and command objects allow additional properties for use by custom
executors and other tools. Isox preserves them in the workspace cache and executor
context: read them through `context.project` and `context.command`. The exported
TypeScript interfaces expose additional fields as `unknown`, so consumers can
narrow them to their own types. Defined Isox fields are still validated.

See [named configurations](/docs/cli#named-configurations) for option overrides and
[Nx project conversion](/docs/nx-migration#project-conversion) for existing Nx files.

Discovery detects project dependencies from TypeScript/JavaScript imports,
re-exports, literal dynamic imports and require calls, including type-only imports
and test files. Package names and subpaths map to their owning projects. Relative
cross-project imports and exact or wildcard TypeScript `paths` aliases also count;
extended configs and project-specific overrides are respected. Aliases can point
to source files or declared compiler output directories, even before a build.

Local package references in `dependencies`, `devDependencies`, `optionalDependencies`,
and `peerDependencies` are also detected. Package aliases and relative workspace
references are supported. Duplicate workspace package names fail discovery.

Use `project.json`'s optional `dependencies` for additional project names that
cannot be inferred, such as dynamically selected plugins or generated inputs.
These are merged with detected dependencies in `.isox/workspace.json`; source
project files stay unchanged. Comments, ordinary strings, Node builtins, self-imports,
dependency folders and generated output are excluded. Merely listing a command's
executor does not add an edge. Affected planning rejects unknown dependencies and
reports dependency cycles.

`plan.weight` is a positive number that estimates a project's relative CI cost.
It defaults to `1`; increasing it gives the project more weight when balancing
shards. Fractional weights are supported. See [affected and CI](/docs/affected-and-ci)
for tag filters, distribution, and the optional `affected.globalFiles` globs in
`isox.json` for shared tooling changes.

## Discovery cache

The first workspace scan saves all discovered project configurations, including
commands, options, and dependencies, to `.isox/workspace.json`. Later
runs of single-project commands read this cache without scanning project files. After adding, removing, or
editing projects, run `isox reset` from anywhere in the workspace to remove the
entire `.isox` directory. The next run recreates the cache. Invalid or outdated
cache files are rebuilt automatically. Keep `.isox/` out of version control.

`affected`, `plan`, and `run-many` always read current project files and refresh
the cache so branch changes and changed weights cannot produce stale plans.

Project initialization refreshes discovery automatically. See
[getting started](/docs/getting-started#define-a-project) to create a project.
