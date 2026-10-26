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

## Discovery boundaries

Discovery honors the workspace's `.gitignore` and nested `.gitignore` files,
including Git-style negation and directory rules. Patterns are case-sensitive on
all platforms. Git does not need to be
initialized. These rules apply even to tracked files; user-wide Git excludes and
`.git/info/exclude` are not consulted.

Use a root `.isoxignore` for additional exclusions that should remain in version
control, such as fixture projects or generated sources:

```gitignore
# Exclude fixtures from project discovery and dependency inference
fixtures/
# Exclude generated directories anywhere in the workspace
**/generated/
```

`.isoxignore` uses the same pattern syntax. Negation can undo rules within that
file, but cannot re-include a path excluded by `.gitignore`. As with Git, an ignored
directory is not traversed: re-include its parent directories before its children.
Ignore-file changes affect the next fresh discovery or dependency-analysis request.
Run `isox reset` before a single-project command if the change adds or removes
projects from discovery.

`node_modules`, `.git`, and `.isox` are always excluded. A nested `isox.json`
marks an independent workspace; its entire subtree belongs to that workspace.
Discovery skips symlinked files and directories, including symlinked projects.
The workspace root itself can be reached through a symlink. Add generated output
directories to `.gitignore` or `.isoxignore` so copied `project.json` files cannot
become projects. TypeScript dependency inference also excludes configured compiler
outputs.

These files control discovery. Use `affected.ignoreFiles` to omit changed file
paths from affected selection, including paths otherwise owned by a root project.

## Dependency discovery

Dependency analysis runs when affected selection or an executor requests it.
Parsing project definitions alone does not run it. TypeScript configs are optional;
projects without them participate through manifests, imports and explicit dependencies.

The resolver detects project dependencies from TypeScript/JavaScript imports,
re-exports, literal dynamic imports and require calls, including type-only imports
and test files. Package names and subpaths map to their owning projects. Relative
cross-project imports and exact or wildcard TypeScript `paths` aliases also count;
extended configs and project-specific overrides are respected. Aliases can point
to source files or declared compiler output directories, even before a build.
Output ownership uses the build target's `options.tsConfig`, including its default
configuration and inherited `outDir`, `declarationDir`, and `rootDir`. When that
option is absent or its file does not exist, the resolver uses the project's
`tsconfig.json`, then the workspace's `tsconfig.base.json` or `tsconfig.json`.
Source aliases use the project or shared editor config. Existing malformed
configs produce an error; no config is required for a plain JavaScript project.

Local package references in `dependencies`, `devDependencies`, `optionalDependencies`,
and `peerDependencies` are also detected. Package aliases and relative workspace
references are supported. Duplicate workspace package names fail dependency analysis.

Use `project.json`'s optional `dependencies` for additional project names that
cannot be inferred, such as dynamically selected plugins or generated inputs.
These are merged with detected dependencies in memory; the definitions cache and
source project files stay unchanged. Comments, ordinary strings, Node builtins, self-imports,
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

Isox keeps two caches with different purposes. Neither caches task results or
skips the compiler, linter, test runner, or other executor work.

| File | Contents | When it is checked |
| --- | --- | --- |
| `.isox/workspace.json` | Validated project definitions and explicitly declared `dependencies` | Single-project commands load it directly; selection commands refresh it |
| `.isox/discovery.json` | Per-project dependency-analysis results, fingerprints and resolution probes | Only when affected selection or an executor requests dependencies |

### Project definitions

A cache hit in `parseWorkspace` reads only `workspace.json`: no source scanning,
import analysis, content hashing or source metadata checks. Run `isox reset` after
adding, editing, moving or removing `project.json` files, or changing which
projects the ignore rules include, before using a single-project command.
Source-body and import edits do not invalidate the definitions cache.

`affected`, `plan`, and `run-many` read current project definitions and rewrite
`workspace.json` on every invocation. They do not require reset after project
changes. A `run-many` worker command then loads the definitions cache created by
its parent; this refresh does not itself infer dependencies.

### On-demand dependency analysis

Affected selection requests the full workspace graph to find dependents.
`js:tsc` requests the selected project's dependency closure when remapping source
aliases to built outputs. A valid cached entry avoids parsing that project's
sources and resolving its imports again. A missing or invalid entry is analyzed
and saved. A scoped request records only analyzed projects, so a later full
request still checks or calculates all remaining projects.

| Operation | Dependency analysis requested? |
| --- | --- |
| `isox affected` or `isox plan` with Git selection | Yes, for the whole workspace |
| `isox affected --all`, `isox plan --all`, or `isox run-many` selection | No; executors may request it when tasks run |
| Single-project command using `js:tsc` with aliases to remap | Yes, for that project's dependency closure |
| Other single-project commands | Only if their executor requests it |

Each request reads current workspace package/configuration metadata and discovers
source paths using the ignore rules. It validates source metadata and resolution
probes for the requested projects, including their transitive dependencies.
Unchanged entries avoid source parsing, but validation still has a filesystem
cost. Ordinary commands that do not request dependencies leave `discovery.json`
alone. Package generation performs its own build-specific dependency analysis.

### What the sources SHA means

The `sources` value in each cached project entry is a SHA-256 fingerprint of the
included source paths and each file's identity, size, modification time and change
time. It is **not a hash of source contents or imports**. Isox recalculates it when
a dependency request visits that project, then compares it with the saved value.

The source set includes discovered JavaScript/TypeScript files owned by that
project, including tests and declaration files. Nested projects own their own
files. Ignored files and configured compiler outputs are excluded. This analysis
is not limited to the files selected by a build's `tsconfig`.

| Change | Effect on the next dependency request |
| --- | --- |
| Edit a source file, even just a comment or function body | Its metadata changes the source fingerprint; reanalyze that project's included sources |
| Add, delete, rename, replace or touch an included source file | Revalidate the source fingerprint; a changed fingerprint reanalyzes the project |
| Change ignore rules so sources enter or leave the project | The source set changes and the project is reanalyzed |
| Edit ordinary Markdown, images or JSON application data | No source-fingerprint change; other task or affected-selection rules may still care |
| Change effective TypeScript configuration, package metadata or supplied project definitions | Revalidate the configuration fingerprint; a changed fingerprint invalidates cached analysis |
| A recorded resolution input changes, appears or disappears | Reanalyze entries whose resolution checks no longer match |

Reanalysis currently operates on **all included sources of the invalidated
project**, rather than just the individual edited files. Other requested projects
with valid entries can still reuse their dependency lists. Changes to a dependency
project are checked even when its consumer's entry is valid.

For example, suppose `web` uses `js:tsc` with workspace aliases. The first
`isox build web` analyzes the required projects and caches their dependencies.
Repeating it without changes validates and reuses those entries. Adding a comment
to `apps/web/src/index.ts` causes `web`'s sources to be reanalyzed on the next build;
unchanged dependency projects can reuse their entries. The compiler runs every
time, and `workspace.json` is untouched by dependency analysis.

### What the reads entries mean

Each project's `reads` records TypeScript module-resolution probes: file and
directory existence checks, hashes of configuration/manifest contents read during
resolution, and resolved real paths. For example:

```json
{
  "path": "/Users/node_modules",
  "kind": "directory",
  "value": false
}
```

This records a directory-existence check that returned false. TypeScript package
lookup can check ancestor `node_modules` directories outside the workspace.
Recording that probe does not mean Isox recursively scans the directory. The
checks let it detect changed resolution results, including generated declaration
files appearing or disappearing while import text stays unchanged.

### Reset and recovery

`isox reset` removes the entire `.isox` directory. The next project-discovery
request recreates `workspace.json`; `discovery.json` is recreated only when
dependency analysis is requested. Neither file belongs in version control.

The definitions cache uses format 12; the dependency cache has its own version
and configuration fingerprint. Old or corrupt caches are rebuilt when requested,
and writes publish complete JSON atomically. Do not edit either cache instead of
changing project definitions or source inputs.

Project initialization refreshes discovery automatically. `isox add` invalidates
`workspace.json` after running a generator, leaving dependency entries to be
validated on their next use. See
[getting started](/docs/getting-started#define-a-project) to create a project.

Reset also removes TypeScript output ownership records and locks. Stop active
builds first; existing output files remain, but later builds can no longer clean
stale files tracked only by the removed records. See
[TypeScript state files](/docs/typescript#typescript-state-files) for their purpose.
