# Isox goal and active roadmap

## Goal

Build a lightweight monorepo orchestrator with explicit project configuration,
deterministic execution, dependency ordering, affected-project selection, and
reusable task results locally and across CI workers. Keep the native runtime
simple, inspectable, and independent of Nx and background daemons.

This preserves the original blueprint's orchestration goals while reflecting
our decision to use Isox's own contract. Projects use `project.json` with
`dependencies` and `executors`; executor packages expose an `executors.json`
manifest and receive Isox's native context. The runtime uses TypeScript/Node.js,
`cac` for CLI parsing, and `fast-glob` for discovery.

Nx support is only a temporary path for initial migration and evaluation, limited
to Nx 23. Projects adopting Isox should replace Nx executors and configuration
helpers with native Isox executors or direct tool invocations, then remove unused
Nx dependencies and adapter settings. Full Nx compatibility and support for other
Nx versions are outside this goal. See the [migration prompt](docs/prompts/migrate-nx-to-isox.md).

## Maintaining this checklist

This file is the repository's active implementation checklist. Update it in the
same change that implements or changes a capability. Check an item only after
its behavior is implemented, documented, and validated. Keep partially implemented
items unchecked and describe the remaining work. Link implementation/tests or
issues when useful; do not mark features complete solely because their
configuration is accepted as custom metadata.

Project dependency graphs, affected selection and weighted CI plans are now
implemented. The next orchestration milestone is **1: prerequisite task graphs**;
follow-up robustness work in milestone 0 can proceed alongside it. Unchecked
command/configuration proposals below are not implemented contracts.

## Current capability boundary

Isox discovers projects, runs individual or multiple commands, and selects
affected projects through Git changes and explicit reverse dependency edges.
Weighted plans use `plan.weight` (default 1), exact project lists and bounded
worker concurrency. Native GitHub actions plan/run these lists and are used in
our CI. See [affected projects and CI](docs/affected-and-ci.md).

`dependencies` does not yet schedule prerequisite tasks. `dependsOn`, task
inputs/outputs, hashing, artifact transfer, and sandboxing are not implemented.
Build prerequisites must be prepared explicitly before workers run.

`.isox/workspace.json` caches project configuration only. It does not cache task
results. Single-project commands require `isox reset` after project changes;
affected selection, planning and run-many always scan fresh project definitions.
The Nx adapter's inferred graph and separate Nx file-map cache serve migration
executors only and do not implement the native roadmap.

## 0. Foundation and current implementation

- [x] Bootstrap a pnpm workspace with TypeScript 7 builds and separate core/CLI packages.
- [x] Compile repository packages through `@isox-sh/js:tsc` project commands, with a clean-checkout bootstrap and no package build scripts.
- [x] Generate distributable TypeScript package manifests, copy assets, safely remove owned stale output, and watch/recover/cancel through the native runner. See the [TypeScript executor guide](docs/typescript.md) for behavior and limits.
- [x] Resolve first-party shorthand executor names such as `js:tsc` and `core:run-command`, preferring first-party packages before unscoped fallbacks.
- [x] Run package suites through `vitest:test`, with package-local Vitest tests and configuration.
- [x] Require Node.js 24+ for the runtime and Node.js 24 or 26+ for Vitest tooling.
- [x] Enforce ESLint rules, sorted imports, and code without semicolons.
- [x] Keep tests inside their owning packages and give all packages native Isox project commands.
- [x] Discover the nearest `isox.json`; initialize it with the CLI package version without overwriting existing files.
- [x] Discover and validate `project.json`, derive project roots/names, reject duplicate or invalid names, and preserve custom properties.
- [x] Publish the project schema and typed project/command/executor contracts.
- [x] Persist validated discovery data atomically and implement `isox reset` to remove `.isox`.
- [x] Support `isox <command> <project>` and `isox run <project>:<command>`, with actions in separate folders.
- [x] Merge named/default configurations, including `--prod`, `--config`, `--configuration`, and `-c`.
- [x] Load native command manifests and handle synchronous, promised, and streamed executor results and failures.
- [x] Provide a native shell-command executor and a small logger with levels, reporters, and verbose diagnostics.
- [x] Resolve built-in commands from the CLI's core dependency when core is not directly installed in the workspace, while preserving workspace overrides.
- [x] Migrate recognized Nx project schemas in memory and cache the converted definitions without rewriting source files.
- [x] Select temporary Nx adapters through `nx.executors`, supply dependency metadata, and reject installed Nx runtimes outside version 23.
- [x] Add regression coverage for graph metadata, external npm nodes, cache reuse, unsupported Nx versions, and configuration errors.
- [x] Configure CI to build, lint, and run affected package suites through our weighted plan/run-many actions, with per-worker bootstrapping and an aggregate required check.
- [ ] Define automatic discovery-cache invalidation for added, changed, renamed, and removed project files, with a cache format/version strategy.
- [ ] Define discovery boundaries for nested workspaces, generated output directories, ignored projects, and symlinks.
- [ ] Test cancellation and signal propagation through shell children, executor streams, and the Nx graph worker; avoid leaving running children behind.
- [ ] Make the Nx 23 webpack/package-generation smoke fixture reproducible in CI while the adapter remains supported.
- [ ] Validate packed CLI/core installation and the `isox` binary outside this checkout, including local/global installation instructions.
- [ ] Exercise the declared Node support range and Windows/Linux/macOS behavior in CI.

Foundation code: [workspace](packages/core/src/workspace/),
[executors](packages/core/src/executor/), [CLI](packages/cli/src/),
[core tests](packages/core/tests/), and [CLI tests](packages/cli/tests/).

## 1. Explicit dependency and task graphs

Build a native graph from declarations. Do not depend on the Nx adapter or source
AST inference. Start with project names in `dependencies`; decide separately
whether to opt into package-manifest dependency mapping.

- [x] Validate dependency references and report cycles with the complete cycle path during affected selection/planning.
- [x] Build forward and reverse project edges with deterministic ordering and safe handling of isolated projects.
- [ ] Decide whether/how package names map to project names, including conflicting declarations and dependency types.
- [ ] Specify and validate native command prerequisites, including the proposed `dependsOn: ['^build']` dependency-command syntax.
- [ ] Define missing prerequisite commands, self-project prerequisites, and configuration propagation explicitly.
- [ ] Produce an inspectable task plan before executing; deduplicate shared prerequisites and identify tasks by project, command, and configuration.
- [ ] Run the task DAG in dependency order, then add bounded concurrency with clear failure and cancellation behavior.
- [ ] Test chains, diamonds, cycles, missing references, and failures that must block downstream tasks.

Completion criterion: a build that requires dependency builds executes each
prerequisite once, in valid order, with deterministic planning and useful errors.

## 2. Affected projects and tasks

Use Git changes plus the native reverse dependency graph. Avoid shell-interpolated
Git commands: pass revisions and arguments through an argument-vector API and
use NUL-delimited paths.

- [x] Define base/head selection and use their merge base for committed changes; report missing refs and shallow-history failures clearly.
- [x] Include staged/unstaged and untracked changes only through explicit local flags; actions compare committed changes.
- [x] Map changed paths to the most specific project root; handle root projects, deletions, renames, unusual filenames, symlinked roots and nested workspaces.
- [x] Define built-in workspace-wide inputs, configurable `affected.globalFiles`, and conservative all-project selection for unowned paths.
- [x] Include transitive dependents before filtering by command, tag expressions and `ci=off`.
- [ ] Expand required prerequisite tasks after affected selection once milestone 1's task contract exists.
- [x] Add `isox affected --target=...`, `--print-matrix` for project arrays, and `isox plan` for weighted matrix JSON.
- [x] Keep JSON stdout free of logs, including verbose cache diagnostics; return stable empty results.
- [x] Test with temporary Git repositories containing branching history, nested roots, local changes, renamed/deleted files and shallow clones.

Completion criterion: a shared-library edit selects its dependents, unrelated
projects are excluded, and CI can parse the planner output directly.

## 3. Deterministic task hashing and local result caching

Define task inputs and outputs before implementing result reuse. Discovery-cache
entries must never be interpreted as proof that a task succeeded.

- [ ] Add typed, validated input/output declarations and opt-in cacheability to the native command schema.
- [ ] Hash normalized inputs deterministically: file paths/content, effective command/options/configuration, dependency task inputs, declared environment, lockfiles, executor/tool versions, and relevant platform/runtime details.
- [ ] Specify missing files, ignored/generated files, file modes, symlinks, and inputs outside the project root.
- [ ] Store successful task outputs, execution metadata, and terminal logs in an atomic local cache entry keyed by the hash.
- [ ] Restore declared outputs and replay logs on a hit; distinguish a cache hit from an executed task in diagnostics.
- [ ] Handle stale outputs and partial/corrupt entries; never cache failed or cancelled runs as successes.
- [ ] Add bypass and cleanup controls, and define their interaction with `isox reset` and discovery data.
- [ ] Test hash stability, each invalidation input, output restoration, corruption, and concurrent cache writers.

Completion criterion: identical declared inputs restore equivalent outputs,
changed inputs cause a miss, and unsuccessful tasks cannot produce reusable hits.

## 4. Remote result caching

Reuse the local artifact contract through an optional storage interface. Start
with one provider; S3, Azure Blob, and GCP are potential adapters, not current
integrations. No cloud deployment is required by this roadmap-writing task.

- [ ] Define a small provider interface for fetching and publishing content-addressed task artifacts.
- [ ] Choose and implement the first provider with documented credentials and namespace configuration.
- [ ] Verify artifact integrity and restrict extraction to declared workspace outputs.
- [ ] Define read-only mode, timeouts, retry behavior, and fallback to local execution on remote-cache failures.
- [ ] Separate trust boundaries for untrusted pull requests and trusted artifact publishers.
- [ ] Test archive round trips, missing/corrupt objects, interrupted uploads, and concurrent publication.

Completion criterion: a second clean worker can restore a successful first
worker's result without running the task, with verified artifacts and clear
failure behavior.

## 5. CI task distribution

The initial GitHub Actions matrix workflow is implemented. Dependency task
ordering and artifact transfer still need an explicit design; a matrix alone is
not a distributed scheduler.

- [x] Define matrix JSON with exact project lists, configuration, pre/post stages, worker concurrency, shard indices and weights.
- [x] Balance projects with positive `plan.weight` values (default 1), deterministic heavy-first assignment and no empty shards.
- [x] Add native plan/run-many actions and document migration from `nx-extend/actions`, without requiring Nx at runtime.
- [x] Use the PR base SHA for pull requests and the nearest reachable Git tag for other events; select all projects when no tag is reachable. Honor explicit refs, reject shallow tag discovery, and verify planned/worker heads.
- [ ] Extend matrix plans with native prerequisite task relationships once that contract is implemented.
- [ ] Define execution waves or worker-side prerequisite handling so dependent builds do not race.
- [ ] Integrate remote results or artifact transfer between jobs, with deterministic retry/failure aggregation.
- [x] Handle empty plans, the 256-job matrix limit, cancellation, bounded worker concurrency and failure aggregation.
- [x] Dogfood weighted affected test jobs in our CI; test action output files and worker handoff locally. A hosted workflow run remains to be observed after push.
- [ ] Demonstrate a multi-job build that matches the equivalent local task plan and outputs.

Completion criterion: CI executes the same valid task plan as local orchestration,
with correct prerequisite results available to each worker.

## 6. Optional reproducibility and isolation

Treat these as explicit execution modes with stated guarantees. Environment
filtering and output checks can improve reproducibility. Symlinking inputs or
checking files after a run does not prevent filesystem access and is not a
hermetic sandbox.

- [ ] Add an explicit environment allowlist and document essential runtime/tool variables and secret handling.
- [ ] Define declared-output checks and their limitations, including modifications and deletions outside outputs.
- [ ] Prototype isolated execution with materialized declared inputs and explicit dependency artifacts.
- [ ] Decide whether stronger filesystem/network enforcement requires OS isolation or containers; document guarantees per platform.
- [ ] Test undeclared input access, unexpected writes, environment leakage, cleanup, and reproducible output restoration.

Completion criterion: each mode has enforceable, tested guarantees. Do not label
ordinary shell execution or symlink-based staging as hermetic.

## Validation record

Update this record alongside the checklist after each review. Tests remain under
`packages/*/tests`, including future graph, Git, caching, and scheduling fixtures.

Review date: 2026-10-24.

- Baseline: 98 package tests passed before this cleanup.
- Cleanup: file-specific JSON parse errors; preserved inferred application node
  types; enforced the installed Nx 23 runtime boundary; added CI lint and tests.
- Final checks on Node.js 24.19.0: `pnpm build` and `pnpm lint` passed;
  `pnpm isox test core` passed 87 tests and `pnpm isox test cli` passed 17 tests
  (104 total). These exercise the same test commands added to CI.
- An isolated production webpack build using Nx 23.3.0 passed, including
  generated package metadata for `tslib` and a dependency imported through a
  shared library. This is a local smoke check, not a committed CI integration.
- Documentation links and `git diff --check` passed.
- Existing in-progress schema/name-validation changes were preserved and included
  in verification.
- Broader guarantees remain unchecked above: the current suite does not prove
  hermeticity, remote-cache correctness, distributed scheduling, or full Nx
  compatibility. CI configuration still needs an actual hosted run.

Affected and CI implementation: 2026-10-25.

- Added explicit project graphs, Git-based affected selection, clean JSON output,
  weighted plans, isolated concurrent workers and native plan/run-many actions.
- Built all packages through `node scripts/bootstrap.cjs`; ESLint passed.
- Replayed our CI action entry points locally with all eight suites split across
  three weighted shards: **235 tests passed** (core 98, CLI 44, JS 34, Nx 41,
  ESLint 5, Vitest 4, E2E plugin 7, end-to-end 2).
- Added real Git fixtures for branching, renames/deletions, local changes,
  symlinked/nested workspaces and shallow clones; covered weight balancing,
  filtering, exact action outputs, empty plans, cancellation and worker failure.
- `actionlint` 1.7.12 validated `.github/workflows/pull-requests.yml`; `git diff --check`
  passed. The hosted GitHub workflow remains unobserved until this change is pushed.
- Prerequisite task scheduling and artifact transfer remain unchecked. Our CI
  workers bootstrap all required package outputs before running affected tests.

Code review and tag-based planning: 2026-10-25.

- Separated tag filters, command validation, and weighted distribution; parse tag
  expressions once per selection. Shared CLI configuration parsing and signal
  handling, and reused process-tree cancellation in the compiler.
- Grouped package dependency rewriting with dependency inference, centralized
  schema discovery, and used explicit workspace refreshes instead of deleting
  cache files before discovery.
- Non-PR actions select the nearest reachable annotated or lightweight tag.
  Real Git fixtures cover unrelated branches, explicit overrides, tags on HEAD,
  no reachable tags, and shallow checkouts. PR selection still uses its base SHA.
- Fixed cancellation of failed executor streams without suppressing ordinary
  failures; verified iterator cleanup and compiler descendant termination.
- All **237 tests passed** (core 99, CLI 45, JS 34, Nx 41, ESLint 5, Vitest 4,
  E2E plugin 7, end-to-end 2). Built all packages and exercised the CI actions
  locally. ESLint, workflow lint, local documentation links, and whitespace checks
  passed. A hosted workflow run remains unobserved.

Second review: 2026-10-25.

- Fixed numeric-looking CLI values being coerced to numbers: Git tags, project
  and command names, tag filters, and configuration names now retain their exact
  spelling. Covered leading zeros, aliases, numeric pre/post commands, and Git refs.
- Added early stage validation. The later contract fix below replaces the initial
  comma restriction with exact JSON transport for all schema-valid command names.
- Reproduced and fixed worker cancellation leaving a stubborn executor process
  alive. Workers now allow five seconds for executor cleanup before forced
  termination, exceeding the executor subprocess grace period of two seconds.
- All **239 tests passed** through the local plan/run-many actions (core 99,
  CLI 47, JS 34, Nx 41, ESLint 5, Vitest 4, E2E plugin 7, end-to-end 2).
  Package builds, ESLint, and workflow lint passed. The `pull-requests` workflow
  remains limited to pull requests and merge groups.

Planner/worker stage contract fix: 2026-10-25.

- Removed the worker's separate stage-name rules and comma-delimited transport.
  Stages now travel as JSON arrays and use core's shared parser during planning
  and execution. Comma-containing command names remain valid under the project
  schema and are preserved exactly, including their selected configurations.
- Added CLI JSON stage flags with conflict checks against their list counterparts.
  Regression tests execute actual planner/worker actions with comma-containing
  names and verify that both paths reject malformed stages before any task runs.
- Package builds, ESLint, workflow lint, and **148 core/CLI tests passed**
  (core 100, CLI 48). Other package suites were unchanged in this fix.

Follow-up review: 2026-10-25.

- Fixed short option assignments such as `-c=acc` and `-t=01`: the string-value
  recovery parser now removes the assignment separator while preserving leading
  zeros and literal leading equals signs in option values.
- Fixed abort-aware executor promises and streams being reported as task failures
  on cancellation. Abort errors and the signal's own reason now preserve signal
  exit codes and cleanup; unrelated failures still propagate.
- Added regression coverage for native/Nx configuration aliases, exact planner
  values, executor cleanup, and SIGINT/SIGTERM exit statuses.
- Package builds, ESLint, workflow lint, and **156 core/CLI tests passed**
  (core 106, CLI 50). Other package suites were unchanged in this review.
