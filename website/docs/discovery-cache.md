---
title: "Discovery cache"
description: "Understand workspace snapshots, dependency analysis, and reset behavior."
icon: "database"
---

Isox caches project definitions and dependency analysis separately. A cached workspace definition does not mean a build or test can be skipped; that is [task caching](/docs/task-caching).

## Discovery cache

Isox keeps separate metadata caches for definitions, dependencies, and tool lookup.
None of these skips executor work. Opt-in [task results](/docs/task-caching) are stored separately under `.isox/tasks`.

| File | Contents | When it is checked |
| --- | --- | --- |
| `.isox/workspace.json` | Validated project definitions with merged target defaults and explicitly declared `dependencies` | Single-project commands load it directly; selection commands refresh it |
| `.isox/discovery.json` | Per-project dependency-analysis results, fingerprints and resolution probes | When affected selection, a cacheable task, or an executor requests dependencies |
| `.isox/tools.json` | Validated package lookup directory listings | When a cacheable task hashes its installed tools |

### Project definitions

A cache hit in `parseWorkspace` reads only `workspace.json`, including already
merged target defaults: no settings reads, source scanning, import analysis,
content hashing or source metadata checks. Run `isox reset` after adding, editing,
moving or removing `project.json` files, changing `targetDefaults`, or changing
which projects the ignore rules include, before using a single-project command.
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
| Native target with `cache: true` | Yes, for hashing its dependency closure |
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
unchanged dependency projects can reuse their entries. Without task caching enabled, the compiler runs every
time. `workspace.json` is untouched by dependency analysis.

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

The definitions cache uses format 14; the dependency cache has its own version
and configuration fingerprint. Old or corrupt caches are rebuilt when requested,
and writes publish complete JSON atomically. Do not edit either cache instead of
changing project definitions or source inputs.

Project initialization refreshes discovery automatically. `isox add` invalidates
`workspace.json` after running a generator, leaving dependency entries to be
validated on their next use. See
[getting started](/docs/getting-started#define-a-project) to create a project.

Reset also removes task results, TypeScript output ownership records and locks. Stop active
builds first; existing output files remain, but later builds can no longer clean
stale files tracked only by the removed records. See
[TypeScript state files](/docs/typescript-builds#typescript-state-files) for their purpose.

[Back to workspace configuration](/docs/configuration).
