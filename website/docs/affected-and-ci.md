---
title: "Affected projects and GitHub Actions"
description: "Select changed projects and distribute exact project lists across weighted CI jobs."
sidebarTitle: "Affected projects and CI"
icon: "code-branch"
---

Isox selects changed projects and their transitive dependents using Git and
dependencies inferred during workspace discovery, plus explicit `dependencies`
in each `project.json`. The same selection powers local
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
  `ISOX_BASE` or `origin/main`, and `ISOX_HEAD` or `HEAD`. Use `--base` and `--head`
  to override them. Isox uses the currently checked-out project definitions.
- Staged and unstaged files are included only with `--uncommitted`; non-ignored
  untracked files only with `--untracked`. `--all` bypasses Git and cannot be
  combined with Git selection flags. The actions compare committed changes only.
- Each changed file belongs to the most specific project root, using directory
  boundaries. Renames include both paths and deleted files still count. Changes
  outside a nested Isox workspace are ignored.
- Changes to root manifests, lockfiles, `isox.json`, root `tsconfig*.json`,
  `eslint.config.*`, or `.github/**` affect every project, even with a root project.
  Other files outside every known project do not affect any projects by default,
  including files from deleted projects. Add shared scripts or other unowned inputs
  to `affected.globalFiles` when their changes should affect every project.
- `affected.ignoreFiles` excludes matching files before checking global patterns
  or project ownership. Ignored changes do not select projects or their dependents.
- All transitive dependents are included **before** command and tag filtering.
  Discovery combines source imports, TypeScript aliases, local package references,
  and explicitly declared project dependencies. Type-only imports and tests count.
  Dynamically selected plugins need explicit dependencies; executor selections
  alone do not add edges. Unknown references and cycles fail with an explanation.
  See [dependency discovery](/docs/configuration#project-definitions).
- Projects without the requested command and projects tagged `ci=off` are
  excluded from selection. Explicit `run-many --projects-json` runs exactly its
  list, including a project tagged `ci=off`.

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
refresh the discovery cache. They do not require `isox reset` after project
changes. Single-project commands retain the normal discovery-cache behavior.
Missing revisions or incomplete history are errors with fetch guidance; Isox
does not turn a Git failure into a successful empty plan.

## Weighted distribution

Set a positive numeric `plan.weight` in `project.json`:

```json
{
  "name": "api",
  "dependencies": ["shared"],
  "plan": { "weight": 5 },
  "targets": {
    "test": { "executor": "vitest:test" }
  }
}
```

The default weight is **1**. Increasing it tells the planner that the project
needs proportionally more work; fractional positive weights are accepted. This
is an estimate you maintain, not measured execution time, and applies to every
command on that project.

For each target, the planner sorts projects by descending weight and assigns each
to the shard with the lowest total weight. Equal loads prefer fewer projects,
then the earlier shard. Project names break equal-weight ties. This makes plans
deterministic and prevents a heavy project from being grouped with several other
heavy projects merely because their names sort together.

There are at most `maxJobs` non-empty shards (default `1`), at most one shard per
selected project, and at most 256 rows across the entire matrix. `parallel`
(default `1`) is the concurrency **inside each worker**, separate from the number
of GitHub jobs. Each row contains:

```json
{
  "target": "test",
  "projects": ["api", "shared"],
  "config": "",
  "parallel": 1,
  "preTargets": [],
  "postTargets": [],
  "tag": "",
  "index": 1,
  "count": 3,
  "weight": 6
}
```

`index` is one-based. `weight` is the sum of project weights. The exact `projects`
list is authoritative; workers never rerun affected detection or calculate their
own slices from `index` and `count`.

## Tag filters and multiple targets

Filters support a literal tag (`backend`), equality (`type=frontend`), and
inequality (`type!=frontend`). Commas mean AND; newlines mean OR. An inequality
also matches a project without that tag key. Any matching forbidden value excludes
the project, including a project with multiple values for the same key.

```sh
isox plan --target=build --tag='type!=frontend,type!=worker' --max-jobs=3
```

For multiple commands, use `plan --targets-json` with an array of objects whose
fields are `target`, `tag`, `maxJobs`, `parallel`, `config`, `preTargets`, and
`postTargets`. These are the same settings used by the plan action below.
Unknown settings and duplicate target names fail. Create separate plans when
running the same target with different configurations or filters.

`preTargets` and `postTargets` are ordered arrays of commands, optionally
`command:configuration`. Each entry is an exact command reference:
`["prepare,assets:acc"]` runs the command named `prepare,assets` with configuration
`acc`. The actions transfer these arrays as JSON, and planning and execution use
the same core stage parser.

On the CLI, `--pre-targets` and `--post-targets` split comma- or newline-separated
lists. Use `--pre-targets-json '["prepare,assets:acc"]'` or `--post-targets-json`
for exact names containing commas. Each JSON flag is mutually exclusive with its
corresponding list flag.

Each stage completes across the worker's projects before
the next stage starts. Missing pre/post commands are skipped. Their configurations
are explicit or use the command's default; the main target's configuration does
not leak into them. There is no implicit production configuration for build.

## GitHub Actions

The actions run on Node.js 24 and require an installed Isox CLI with these commands
and the project's executor plugins. Install dependencies in both planning and
worker jobs. The actions invoke that installed CLI without downloading packages.
Use `cliPath` to select a custom built CLI JavaScript entry point relative to
`workingDirectory`. `workingDirectory` selects a nested workspace.

```yaml
name: Affected tests
on: [pull_request, workflow_dispatch]
permissions:
  contents: read

jobs:
  setup:
    runs-on: ubuntu-latest
    outputs:
      matrix: ${{ steps.plan.outputs.matrix }}
      hasPlan: ${{ steps.plan.outputs.hasPlan }}
      head: ${{ steps.plan.outputs.head }}
    steps:
      - uses: actions/checkout@v7
        with:
          fetch-depth: 0
      - uses: actions/setup-node@v7
        with:
          node-version: 24
      - run: npm ci
      # Prepare any prerequisite build outputs before testing.
      - uses: isox-sh/isox/actions/plan@main
        id: plan
        with:
          targets: test
          targetOptions: '{"test":{"maxJobs":3,"parallel":2}}'

  test:
    needs: setup
    if: needs.setup.outputs.hasPlan == 'true'
    runs-on: ubuntu-latest
    strategy:
      fail-fast: false
      matrix: ${{ fromJSON(needs.setup.outputs.matrix) }}
    steps:
      - uses: actions/checkout@v7
      - uses: actions/setup-node@v7
        with:
          node-version: 24
      - run: npm ci
      # Build or restore prerequisites needed by this worker's test commands here.
      - uses: isox-sh/isox/actions/run-many@main
        with:
          plan: ${{ toJSON(matrix) }}
          head: ${{ needs.setup.outputs.head }}
```

For pull requests, planning compares the PR base SHA with the checked-out GitHub
merge commit. For other events, including pushes, merge groups, and manual
dispatches, it uses the nearest Git tag reachable from the checked-out commit.
Both annotated and lightweight tags qualify; tags on unrelated branches do not.
"Latest" follows Git history (`git describe --tags`), not version-number ordering
or the most recently created tag across the repository.

The `base`/`head` inputs take precedence, followed by `ISOX_BASE`/`ISOX_HEAD`.
Without a reachable tag, non-PR runs select all projects. `affectedOnly: false`
always selects all. A tag directly on HEAD produces an empty affected plan;
provide an earlier `base` or disable affected selection to rebuild that release.
The planner verifies the requested head matches the checkout and outputs resolved
commit SHAs. Pass its `head` to workers to verify their checkout too.

Use `fetch-depth: 0` in the planning job to fetch full history and tags. Automatic
tag selection rejects shallow checkouts. It does not query the last successful
workflow run; pass that revision as `base` if your deployment policy requires it.

The plan action also accepts `targets` as a JSON array, such as
`["prepare,assets", "build"]`. Use this form when a command name contains commas
so the exact name survives planning and worker execution.

The outputs are `matrix`, `hasPlan` (strings `true`/`false`), `base`, and `head`.
Gate matrix jobs using `hasPlan` as shown. A plan with different targets does not
order those targets; separate build and deploy jobs with `needs` when ordering
is required.

### Migrating nx-extend workflows

The design follows [nx-extend's actions](https://github.com/TriPSs/nx-extend/tree/master/actions),
with explicit project lists, weight balancing, validated inputs and no Nx runtime.
Replace dynamic inputs such as `buildMaxJobs` with a declared `targetOptions`
object, for example:

```yaml
- uses: isox-sh/isox/actions/plan@main
  id: plan-build
  with:
    targets: build
    targetOptions: |
      {
        "build": {
          "tag": "type!=frontend,type!=worker",
          "maxJobs": 3,
          "config": "acc"
        }
      }
```

A second deploy plan can use
`{"deploy":{"tag":"type=backend","maxJobs":5,"config":"acc"}}`,
and another can use
`{"deploy":{"tag":"type=frontend","maxJobs":1,"parallel":1,"config":"acc"}}`.
These examples assume the selected commands define an `acc` configuration.
Use the existing `matrix` and `hasPlan` wiring and build/deploy `needs` guards.
Pass `toJSON(matrix)` through a string input on your reusable workflow, then give
that string to `actions/run-many`'s `plan` input. Keep the planner's `head` alongside
it. Do not keep the old worker-side `affectedOnly`, `index`/`count` slicing or
project recomputation.

Artifact upload/download remains part of your workflow. These actions do not
implement `storeArtifacts`, `restoreArtifacts`, remote caching or prerequisite
build scheduling. `dependencies` propagates affected changes but does not schedule
`^build` tasks. Pre/post stages apply only within one shard. Prepare prerequisite
outputs in every worker, or transfer them in explicitly ordered jobs; dependent
builds must not rely on another matrix job finishing first.
