---
title: "Workspace and project configuration"
description: "Complete isox.json and project.json field reference, including target options, defaults, inputs, and dependencies."
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
| `targetDefaults` | object | `{}`. Keys are target names or `package:executor` references. Values use the [target fields](#target-reference) below, without requiring an executor. |
| `namedInputs` | object | `{}`. Keys name reusable arrays of [input entries](#input-reference). Project definitions override workspace sets with the same name. |
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

### project.json reference

All top-level project fields are optional. The directory containing `project.json`
is the project root; a custom `root` property does not override it.

| Field | Type | Default and behavior |
| --- | --- | --- |
| `$schema` | string | Optional editor schema URL or path. The shown example uses the bundled project schema. |
| `name` | string | Containing directory name. Must be unique in the workspace, non-empty, and contain no whitespace or colons. |
| `targets` | object | No targets. Keys are non-empty target names without whitespace or colons; each value requires an `executor`. See [target reference](#target-reference). |
| `dependencies` | unique string array | No additional dependencies. Project names are merged with inferred dependencies; this is not a list of npm packages. Names cannot contain whitespace or colons. |
| `namedInputs` | object | Workspace input sets are inherited. Each local key replaces the entire set with that name. See [input reference](#input-reference). |
| `tags` | unique string array | `[]`. Non-empty labels used by selection, such as `type=frontend`. `ci=off` excludes ordinary automatic selection. |
| `plan` | object | Optional project selection and distribution settings. |
| `plan.enabled` | boolean | `true`. `false` excludes automatic selection; direct commands, exact project lists, and prerequisite execution can still run the project. |
| `plan.weight` | positive number | `1`. Relative cost when balancing CI shards; fractional values are allowed. |

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

## Target reference

A target lives at `project.json.targets.<name>`. The same optional fields can be
supplied by `isox.json.targetDefaults.<target-or-executor>`. Defaults only apply
to targets already declared by projects; every project target needs its own
`executor`. The defaults below apply after workspace and project settings merge.

| Field | Type | Default and behavior |
| --- | --- | --- |
| `executor` | string | Required on project targets. `package:executor`, such as `js:tsc` or `core:run-command`. Both parts must be non-empty and contain no whitespace or colons. |
| `options` | object | `{}`. Executor-specific base options. See the executor's reference for supported keys and defaults. |
| `configurations` | object of option objects | `{}`. Each key names one set of executor-option overrides. Names cannot be empty or contain whitespace, colons, or commas. |
| `defaultConfiguration` | string | No configuration selected automatically. Must name an existing configuration; an explicit CLI selection takes precedence. |
| `dependsOn` | array of strings or dependency objects | `[]`. Tasks that must succeed first. Local arrays replace inherited ones; `[]` clears them. See [task prerequisites](#task-prerequisites) for every string form and object field. |
| `cache` | boolean | `false`. Opts deterministic native tasks into result caching. See [task caching](/docs/task-caching) for exclusions and output ownership. |
| `inputs` | input-entry array | The `default` named set, falling back to all project files. A local array replaces inherited inputs. `[]` omits local file/environment inputs; automatic workspace metadata and dependency inputs still participate. |
| `outputs` | unique string array | No artifact directories; cache successful results and logs only. Entries are concrete workspace-relative directories, with path tokens supported. No globs or individual files. `[]` clears inherited outputs. |

`configurations.<name>` contains executor options directly. It is not another
target definition: placing `cache`, `dependsOn`, or `inputs` there passes those
keys to the executor instead of changing task scheduling or caching. Nested option
objects and arrays are replaced when overrides merge. See [target defaults](#target-defaults)
for the full precedence order.

For example, this target uses a prerequisite, caching, and two shell-command
configurations:

```json
{
  "targets": {
    "prepare": {
      "executor": "core:run-command",
      "options": { "command": "node tools/prepare.mjs" }
    },
    "build": {
      "executor": "core:run-command",
      "dependsOn": ["prepare"],
      "cache": true,
      "inputs": ["production", "^production", { "env": "BUILD_MODE" }],
      "outputs": ["{workspaceRoot}/dist/{projectName}"],
      "options": { "command": "node tools/build.mjs", "cwd": "." },
      "configurations": {
        "development": { "command": "node tools/build.mjs --mode=development" },
        "production": { "command": "node tools/build.mjs --mode=production" }
      },
      "defaultConfiguration": "production"
    }
  }
}
```

This example uses the workspace's `production` input set shown above. The build
script must write to the declared output directory and every file it reads must
be included in the inputs. Add script files outside project roots to a shared set.

Executor option references: [shell commands](/docs/shell-commands),
[TypeScript](/docs/typescript), [ESLint](/docs/eslint), [Vitest](/docs/vitest),
and [release automation](/docs/semver).

## Input reference

`namedInputs` belongs at the top level of `isox.json` or `project.json`. Each value
is an array using the same entries as target `inputs`. Set names start with a
letter or underscore, followed by letters, digits, underscores, or hyphens.
An empty array defines an empty set.

| Entry | Meaning |
| --- | --- |
| `"{projectRoot}/src/**/*"` | File pattern evaluated for the owning project. Plain paths and globs are workspace-relative. |
| `"{workspaceRoot}/tools/config.json"` | A shared workspace file. `{projectName}` is also supported in paths. |
| `"!{projectRoot}/**/*.test.ts"` | Exclude matching files from that project's selected inputs. Exclusions win over inclusions. |
| `"production"` | Expand the named set for the current project, using its overrides. Strings that do not name a set remain file patterns. |
| `"^production"` | Expand the named set for all direct and transitive dependency projects, using each dependency's overrides. |
| `"^{projectRoot}/src/**/*.ts"` | Select files directly from dependency projects. |
| `{ "env": "BUILD_MODE" }` | Include the environment variable's value. Names start with a letter or underscore and contain only letters, digits, or underscores. Unset and empty values differ. |

Sets can reference other sets. Cycles and missing dependency set names fail.
A local set replaces the workspace set with the same name; other workspace sets
remain available. `default` falls back to `["{projectRoot}/**/*"]` when undefined.
`sharedGlobals` has no special behavior: include it from another set to use it.

Dependency references prefixed with `^` replace automatic dependency source
selection for that task. They do not remove dependency configuration, manifests,
or declared build artifacts from the cache key. Inputs select cache content;
[`dependsOn`](#task-prerequisites) schedules tasks. See
[named inputs](/docs/task-caching#named-inputs) for examples and
[cache keys](/docs/task-caching#inputs-and-the-key) for automatic inputs and path restrictions.

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
[TypeScript state files](/docs/typescript#typescript-state-files) for their purpose.

## Task prerequisites

Set `dependsOn` on a target in `project.json` or in `isox.json` target defaults.
Prerequisites run before the requested task, including before a task cache lookup.

```json
{
  "targetDefaults": {
    "build": { "dependsOn": ["^build"] },
    "test": { "dependsOn": ["build"] }
  }
}
```

Each `dependsOn` entry identifies a target to run first:

- `"build"` runs this project's build first.
- `"^build"` runs build on dependency projects. Dependencies combine declared project names, source imports, and workspace package references.
- `"other:build"` runs a target on a named project.
- Target wildcards such as `"build-*"` and `"^build-*"` expand matching targets.
- `{ "target": "build", "dependencies": true }` is the expanded form of `"^build"`.
- `{ "target": "build", "projects": ["lib-a", "lib-b"] }` selects projects explicitly. `projects` also accepts a single string or glob patterns.
- `{ "target": "prepare", "params": "forward", "options": "forward" }` forwards CLI overrides and configured options independently. Both default to `"ignore"`; forwarded CLI values take precedence.

### Same-project and dependency builds

`"build"` refers to the current project. `"^build"` refers to the projects it
depends on; it does not run the current project's build as a prerequisite of itself.

For example, suppose `app` depends on `shared`. With the `targetDefaults` above,
`isox test app` runs these tasks in order:

```text
shared:build → app:build → app:test
```

The test target's `"build"` entry adds `app:build`. That build target's `"^build"`
entry adds `shared:build`. Each added task expands its own prerequisites, so a
longer dependency chain is built in the same way.

### Expanded entries and forwarded options

Use an object entry when you need to select projects or forward values:

```json
{
  "dependsOn": [
    { "target": "build", "dependencies": true },
    { "target": "prepare", "params": "forward", "options": "forward" },
    { "target": "generate", "projects": ["schema"] }
  ]
}
```

| Field | Behavior |
| --- | --- |
| `target` | Required target name or wildcard pattern. |
| `dependencies` | Set to `true` to select dependency projects. Defaults to `false`. |
| `projects` | Project name, glob pattern, or array of names and patterns. Cannot be combined with `dependencies`. |
| `params` | `"forward"` passes CLI option overrides to the prerequisite; `"ignore"` (default) leaves them out. |
| `options` | `"forward"` passes the caller's configured options, including its selected configuration; `"ignore"` (default) leaves them out. |

Without `projects` or `dependencies: true`, an unqualified target refers to the
same project. Forwarded values override the prerequisite's own options. When both
`options` and `params` are forwarded, CLI overrides win conflicts. Objects and
arrays are replaced rather than deeply merged.

For example, `isox test app --mode=fast` passes `mode: "fast"` to a prerequisite
with `params: "forward"`. Without that setting, the prerequisite receives its own
configured `mode` value. These are executor options; forwarding them does not
automatically append flags to a shell command.

### Scheduling and configuration

Local `dependsOn` replaces inherited dependencies; use `[]` to clear them.
A prerequisite uses the caller's configuration when it defines that configuration,
otherwise its own default. Missing targets on existing projects are skipped, but
an unknown project named in `project:target` fails. `^target`
continues through projects lacking that target to find upstream matches.
Shared prerequisites run once per task graph, identified by project, target, and
configuration. Each multi-target stage has its own graph; all stage graphs are
validated before the first stage runs. Cycles fail before any task executes, and failed prerequisites prevent dependent tasks from starting.

Direct commands and the core `runExecutor` API expand prerequisites. `run-many`
and `affected` expand them after project selection, including prerequisites outside
the selected project list, and honor `--parallel` with isolated worker processes.
Dependencies must finish successfully before dependent tasks start. A prerequisite
that watches for changes or otherwise runs indefinitely prevents its dependents
from starting; use tasks that exit for prerequisites.
