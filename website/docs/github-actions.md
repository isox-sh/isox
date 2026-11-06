---
title: "GitHub Actions"
description: "Plan affected work once and run it across CI workers."
icon: "github"
---

Use one planning job to select projects, then pass its exact plan and commit to each worker. The workflow below runs build, lint, and test stages.

## GitHub Actions

The actions run on Node.js 24 and require `@isox-sh/cli` and the project's executor
plugins in the workspace dependencies. Install dependencies in both planning and
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
      - uses: isox-sh/isox/actions/cache@main
      - run: npm ci
      # Declare test prerequisites with dependsOn, or prepare their outputs here.
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
      - uses: isox-sh/isox/actions/cache@main
      - run: npm ci
      # This worker expands declared dependsOn tasks; prepare any other required outputs here.
      - uses: isox-sh/isox/actions/run-many@main
        with:
          plan: ${{ toJSON(matrix) }}
          head: ${{ needs.setup.outputs.head }}
```

The [cache action](https://github.com/isox-sh/isox/tree/main/actions/cache) restores
`.isox` across compatible runners and later commits, then saves an updated
snapshot after the job succeeds if GitHub permits cache writes. It refreshes
restored project definitions while retaining dependency analysis and other cache data. Each job saves a distinct
snapshot; GitHub restores the newest accessible match without merging parallel
jobs' changes. Native targets explicitly configured for [task caching](/docs/task-caching)
can reuse matching entries; other builds and tests still run.

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

### Execution ordering

When selected targets cache generated outputs, `run-many` orders selected projects
by their dependencies before replacing those outputs. Independent projects still
run concurrently up to `parallel`; consumers wait for selected dependencies to
finish, including when `parallel` is `1`. This implicit ordering only covers
selected projects. Declare [`dependsOn`](/docs/task-prerequisites#task-prerequisites)
to expand required tasks outside that selection. Prerequisites run before cache
lookups and are deduplicated within each stage's task graph. Each matrix worker
expands its own graph in its own checkout; workers do not share task deduplication
or coordinate with other jobs. Builds that replace the running CLI or a selected
executor run alone while their outputs change, so
other workers keep access to their runtime files. Independent application builds
continue to use the configured parallelism.

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
implement `storeArtifacts`, `restoreArtifacts`, or remote caching. Targets with
`dependsOn: ["^build"]` schedule dependency builds in each worker; `dependencies`
alone defines project edges without scheduling tasks. Pre/post stages apply only
within one shard. For cross-job artifact reuse, transfer outputs through explicitly
ordered jobs; dependent builds must not rely on another matrix job finishing first.

[Back to affected projects](/docs/affected-and-ci).
