---
title: "Affected projects and GitHub Actions"
description: "Select changed projects and distribute exact project lists across weighted CI jobs."
sidebarTitle: "Affected projects and CI"
icon: "code-branch"
---

Isox selects affected targets using Git changes, target inputs, and dependencies
inferred on demand, plus explicit `dependencies` in each `project.json`.
The same selection powers local
execution, JSON project lists, and weighted GitHub Actions matrices.

## Local commands

```sh
isox affected --target=build --base=origin/main
isox affected --target=test --base=origin/main --uncommitted --untracked
isox affected --target=build --base=origin/main --print-matrix
isox plan --target=test --base=origin/main --max-jobs=3 --parallel=2
isox run-many --target=test --projects=api,shared --parallel=2
```

`affected --print-matrix` prints only a sorted JSON array, such as `["api","shared"]`.
`plan` prints `{ "include": [...] }` for a full GitHub matrix. Both keep diagnostics
on stderr, even with `--verbose`. Empty selections produce `[]` or
`{"include":[]}` respectively and exit successfully.

Without `--print-matrix`, `affected` executes the selected command. `run-many`
defaults to all projects that have the requested command. For an exact selection,
use `--projects-json='["api","shared"]'`: every project and command must exist, and
the list is neither filtered nor redistributed. An empty JSON list runs nothing.

`--config`, `--configuration`, `-c`, and `--prod` have the same meaning as for a
single project. `--parallel` defaults to `1` and limits concurrent child CLI
processes. Each child has its own cwd, environment, and module state. The first
failure cancels active children and stops queued work; SIGINT/SIGTERM propagate
to the children and return exit codes 130/143.

## What counts as affected?

- Committed changes are `git diff <merge-base(base, head)> <head>`. Defaults are
  `ISOX_BASE`, then `affected.defaultBase` in `isox.json`, then `origin/main` for
  the base; `ISOX_HEAD` or `HEAD` for the head. Use `--base` and `--head` to override
  them. Isox uses the currently checked-out project definitions.
- Staged and unstaged files are included only with `--uncommitted`; non-ignored
  untracked files only with `--untracked`. `--all` bypasses Git and cannot be
  combined with Git selection flags. The actions compare committed changes only.
- Each changed file belongs to the most specific project root, using directory
  boundaries. Renames include both paths and deleted files still count. Changes
  outside a nested Isox workspace are ignored.
- Changes to root manifests, lockfiles, `isox.json`, root `tsconfig*.json`,
  `eslint.config.*`, or `.github/**` affect every project, even with a root project.
  Other files, including paths outside project roots, select targets whose inputs
  consume them. Add shared scripts to `affected.globalFiles` when their changes
  should affect every project regardless of inputs.
- `affected.ignoreFiles` excludes matching files before checking global patterns
  or target inputs and project ownership. Ignored changes do not select projects or their dependents.
- Targets without explicit inputs or a customized `default` named set retain
  conservative selection: file owners and all transitive dependents are included
  **before** command and tag filtering.
  On-demand analysis combines source imports, TypeScript aliases, local package references,
  and explicitly declared project dependencies. Type-only imports and tests count.
  Dynamically selected plugins need explicit dependencies; executor selections
  alone do not add edges. Unknown references and cycles fail with an explanation.
  See [dependency discovery](/docs/project-discovery#dependency-discovery).
- Projects without the requested command, with `plan.enabled: false`, or tagged `ci=off` are
  excluded from selection. Explicit `run-many --projects-json` runs exactly its
  list, including projects excluded from automatic selection.

### Target inputs and prerequisites

`affected` and each target in `plan` use the same resolved file inputs as task
caching, even when `cache` is false. Target defaults apply first; target-level
inputs replace inherited arrays. Named sets can nest, project sets override
workspace sets, and exclusions win within each selection. Shared workspace paths
select every consuming target, regardless of file ownership. Deleted paths and
both rename paths are matched without requiring the files to exist.

For example, code targets can use `inputs: ["production", "^production"]` with
`production: ["{projectRoot}/**/*", "!{projectRoot}/**/*.md"]`. A website target
can instead include `"{workspaceRoot}/packages/**/*.md"`. No Markdown files are
excluded by default.

Without a `^` input, dependency inputs come from each dependency's same-named
target (or its `default` set when that target is absent). `^production` replaces
that automatic source selection and resolves the set in every transitive
dependency. Separate dependency branches retain independent exclusions.
Project definitions, package manifests and cached dependency outputs remain
automatic inputs even with `inputs: []`. Built-in and configured global files
still select all eligible projects; `affected.ignoreFiles` takes precedence.
Environment values, installed tool versions and runtime changes have no Git path;
use `--all` when those changes need validation.

Pre/post stages and `dependsOn` prerequisites also participate: a matching
prerequisite selects its consuming project. Once selected, execution schedules
all required prerequisites, including projects excluded from automatic selection.
Input exclusions do not remove required tasks from that schedule. Invalid named
inputs or task graphs fail with an explanation rather than silently skipping work.

### Exclude a project from automatic selection

Set `plan.enabled` to `false` in `project.json` to exclude it from `affected`,
`plan` (including `--all`), and ordinary `run-many` selection:

```json
{
  "plan": {
    "enabled": false
  }
}
```

It defaults to `true`. Direct commands such as `isox test tools` and exact
`--projects-json` lists can still run the project. The existing `ci=off` tag also
excludes projects for backward compatibility, even with `plan.enabled: true`.

This is a selection filter. The project remains in the dependency graph, and its
changes still propagate to dependents. It cannot hide a cycle. To skip only one
target, leave that target undefined on the project instead.

### Shared and ignored files

For shared tools inside a project, add workspace-relative globs to `isox.json`:

```json
{
  "version": "0.0.1",
  "affected": {
    "globalFiles": ["packages/build-tools/**", "config/**"],
    "ignoreFiles": ["**/*.md", "**/*.mdx"]
  }
}
```

These extend the built-in global files. Use them for shared tools or configuration
that affect multiple projects but are not represented by project dependencies.
Choose patterns narrowly: every matching change selects all projects.

`ignoreFiles` also uses workspace-relative globs and defaults to an empty list.
It takes precedence over both built-in global files and `globalFiles`.
Only exclude files whose changes do not need to trigger your targets; for example,
omit the Markdown exclusions above if your documentation needs building or testing.
Projects can still be selected through other changed files or dependencies.

Affected selection, planning and `run-many` scan current `project.json` files and
refresh `workspace.json`. They do not require `isox reset` after project
changes. Single-project commands reuse cached definitions until reset or an
explicit refresh. Affected selection validates and reuses per-project dependency
entries from `.isox/discovery.json`, computing missing or invalid analysis before
finding dependents. The `sources` SHA uses source paths and metadata; a changed
project is reanalyzed as a whole, including tests. `--all` and `run-many` selection
do not request dependency inference. Execution additionally resolves
dependencies when selected targets cache outputs, so selected dependencies finish
before their consumers. Executors can also request analysis.

Every `run-many` invocation refreshes definitions; its child commands then load
that definitions cache. These caches do not transfer build outputs between CI
jobs or skip task execution. See [cache behavior](/docs/discovery-cache#discovery-cache).
Missing revisions or incomplete history are errors with fetch guidance; Isox
does not turn a Git failure into a successful empty plan.

## Weighted distribution

See [Weighted distribution](/docs/ci-planning#weighted-distribution).

## Tag filters and multiple targets

See [Tag filters and multiple targets](/docs/ci-planning#tag-filters-and-multiple-targets).

## GitHub Actions

See [GitHub Actions](/docs/github-actions#github-actions).

### Execution ordering

See [Execution ordering](/docs/github-actions#execution-ordering).

### Migrating nx-extend workflows

See [Migrating nx-extend workflows](/docs/github-actions#migrating-nx-extend-workflows).
