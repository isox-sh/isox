---
title: "Plan CI work"
description: "Distribute selected projects and filter multi-target runs."
icon: "diagram-project"
---

Create a plan when you need to divide work across CI jobs. Start with [affected selection](/docs/affected-and-ci), then use the [GitHub Actions workflow](/docs/github-actions) to execute the plan.

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

An explicit `maxJobs` caps the jobs for a target. The default is one job unless
an executor reserves a fixed shard count. The entire matrix can contain up to 256 rows. `parallel`
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

## Executor planners

Isox reserves fixed executor shard counts first. Other projects share the
remaining budget using weighted distribution. When each of those projects
already has its own job and the target still has capacity,
Isox offers the remaining jobs to installed native executors that declare a
`planner` entrypoint. The budget is shared among eligible projects in matrix
order. Executors without a planner keep their ordinary project rows.

For example, a single [Playwright project](/docs/playwright) with `maxJobs: 3`
can produce three rows for the same project. Each carries its own main-target
`options`, such as `{"shard":"2/3"}`. Pass the complete matrix row to
`actions/run-many`. Pre- and post-targets run in each job with their own options.

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
`postTargets`. These are the same settings used by the [GitHub Actions plan step](/docs/github-actions#github-actions).
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

[Back to affected projects](/docs/affected-and-ci).
