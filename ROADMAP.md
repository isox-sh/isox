# Isox goal and active roadmap

## Goal

Build a lightweight monorepo orchestrator with explicit project configuration,
deterministic execution, dependency ordering, affected-project selection, and
reusable task results locally and across CI workers. Keep the native runtime
simple, inspectable, and independent of Nx and background daemons.

This preserves the original blueprint's orchestration goals while reflecting
our decision to use Isox's own contract. Projects use `project.json` with
`dependencies` and `targets`; executor packages expose an `executors.json`
manifest and receive Isox's native context. The runtime uses TypeScript/Node.js,
`cac` for CLI parsing, and filesystem discovery with Git-compatible ignore rules.

Nx support is only a temporary path for initial migration and evaluation, limited
to Nx 23. Projects adopting Isox should replace Nx executors and configuration
helpers with native Isox executors or direct tool invocations, then remove unused
Nx dependencies and adapter settings. Full Nx compatibility and support for other
Nx versions are outside this goal. See the [migration prompt](website/docs/prompts/migrate-nx-to-isox.md).

## Maintaining this checklist

This file is the repository's active implementation checklist. Update it in the
same change that implements or changes a capability. Check an item only after
its behavior is implemented, documented, and validated. Keep partially implemented
items unchecked and describe the remaining work. Link implementation/tests or
issues when useful; do not mark features complete solely because their
configuration is accepted as custom metadata.

Project dependency graphs, affected selection and weighted CI plans are now
implemented. The next orchestration milestone is **1: prerequisite task graphs**.
Foundation runtime checks have a dedicated Node/OS CI matrix; its first hosted
run remains to be confirmed. Unchecked command/configuration proposals below are
not implemented contracts.

## Current capability boundary

Isox discovers projects, runs individual or multiple commands, and selects
affected projects through Git changes and inferred or declared reverse dependency edges.
Weighted plans use `plan.weight` (default 1), exact project lists and bounded
worker concurrency. Native GitHub actions plan/run these lists and are used in
our CI. See [affected projects and CI](website/docs/affected-and-ci.md).

`dependencies` does not yet schedule prerequisite tasks. `dependsOn`, task
inputs/outputs, hashing, artifact transfer, and sandboxing are not implemented.
Build prerequisites must be prepared explicitly before workers run.

`.isox/workspace.json` caches project definitions and explicit dependencies only.
It does not cache task results or inferred edges. Single-project commands load
cached definitions directly until reset; affected selection, planning and run-many
refresh definitions. Dependency analysis runs on demand for affected selection or
an executor, with optional source analysis scoped to a dependency closure. These
requests alone validate and populate `.isox/discovery.json` with per-project results.
Valid entries avoid source parsing. A changed source-metadata fingerprint causes
all included sources of that project to be reanalyzed, including tests; it does
not rebuild project definitions or skip executor work. See
[cache behavior](website/docs/configuration.md#discovery-cache).
Discovery honors `.gitignore`/`.isoxignore`, nested workspaces and symlink boundaries.
The Nx adapter's inferred graph and separate Nx file-map cache serve migration
executors only and do not implement the native roadmap.

## 0. Foundation and current implementation

- [x] Bootstrap a pnpm workspace with TypeScript 7 builds and separate core/CLI packages.
- [x] Compile repository packages through `@isox-sh/js:tsc` project commands, with a clean-checkout bootstrap and no package build scripts.
- [x] Generate distributable TypeScript package manifests, copy assets, safely remove owned stale output, and watch/recover/cancel through the native runner. See the [TypeScript executor guide](website/docs/typescript.md) for behavior and limits.
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
- [x] Separate project discovery from on-demand dependency inference. Cache format 12 stores definitions only; affected selection requests the graph and the JS builder requests scoped source analysis. Dependency requests alone validate and populate `discovery.json`; ordinary commands skip its source fingerprints and resolution probes. See [definitions cache tests](packages/core/tests/workspace-cache.test.mjs), [dependency cache tests](packages/core/tests/dependency-cache.test.mjs), and [dependency inference tests](packages/core/tests/workspace-dependencies.test.mjs).
- [x] Share `.gitignore`/`.isoxignore`, nested workspace, dependency-directory and symlink boundaries between project discovery and source inference. Generated directories use ignore rules; compiler outputs are excluded from dependency inference. See [discovery boundaries](website/docs/configuration.md#discovery-boundaries).
- [x] Test cancellation through shell descendants, cooperative executor streams, and Nx graph workers with stubborn subprocesses. The Nx worker now uses process-tree termination. See [native lifecycle tests](packages/core/tests/executor-lifecycle.test.mjs) and [Nx lifecycle tests](packages/nx/tests/nx-workspace-graph.test.mjs).
- [x] Validate real CLI/core tarballs through isolated local and global npm installs, invoke the installed binary outside the checkout, and document installation. See [packed installation tests](packages/cli/tests/packed-install.test.mjs).
- [ ] Confirm the first hosted foundation matrix run: Node.js 24 and 26 on Windows/Linux/macOS is configured in [pull-requests](.github/workflows/pull-requests.yml), including core/CLI tests and packed installations. Local macOS Node 24 and 26 checks pass; hosted results remain pending.

Foundation code: [workspace](packages/core/src/workspace/),
[executors](packages/core/src/executor/), [CLI](packages/cli/src/),
[core tests](packages/core/tests/), and [CLI tests](packages/cli/tests/).

## 1. Explicit dependency and task graphs

Build a native graph without the Nx adapter. Requested dependency analysis combines literal source
imports, TypeScript aliases, and local package-manifest references with additional
project names from `dependencies`. It does not perform type checking or execute
source files while building the graph.

- [x] Validate dependency references and report cycles with the complete cycle path during affected selection/planning.
- [x] Build forward and reverse project edges with deterministic ordering and safe handling of isolated projects.
- [x] Map package names, subpaths, TypeScript aliases and relative imports to project names; merge local package dependency fields and explicit additions, and reject duplicate package names.
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
- Final checks on Node.js 24.19.0: `node scripts/bootstrap.cjs` and `pnpm lint` passed;
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

Automatic workspace dependencies: 2026-10-25.

This records the original cache design. The foundation implementation below
supersedes it with separate definition and on-demand dependency caches.

- Removed internal `@isox-sh/*` dependency declarations from source package
  manifests and duplicate dependency arrays from package project definitions.
  Root TypeScript paths resolve package imports against the original sources.
  The JS executor remaps dependencies to compiled declarations in a temporary
  build config, preserving source aliases for editors and workspace discovery.
- Discovery now merges literal imports, type references, TypeScript path aliases,
  and local package-manifest references with manual project dependencies. It saves
  those edges in cache format 6 without rewriting source project definitions.
- Shared the syntax scanner between discovery and package generation. Published
  manifests retain required internal packages, including workspace type references;
  external plugin lookups no longer imply a dependency on the optional Nx adapter.
- All **265 tests passed** (core 115, CLI 57, JS 34, Nx 41, ESLint 5, Vitest 4,
  E2E plugin 7, end-to-end 2). ESLint and package builds passed. An isolated
  bootstrap starting without `dist` or a workspace cache also built all packages
  and produced the weighted test plan successfully.

Source alias follow-up: 2026-10-25.

- `js:tsc` now uses a temporary config to compile against dependency declarations
  while checked-in TypeScript aliases point to source. Watch mode detects rebuilt
  dependency outputs, and temporary configs are removed after success or failure.
- Added five regression tests for source aliases, wildcard subpaths, inherited
  settings, config-relative paths, declaration directories, missing dependency
  builds, cleanup, and watch updates.
- ESLint and **156 core/JS/end-to-end tests passed** (115, 39, and 2). Package
  builds and an isolated bootstrap without existing outputs or cache also passed.

Editor configuration follow-up: 2026-10-25.

- Moved package compilation settings into `tsconfig.build.json` files and added a
  workspace `tsconfig.json` for editor analysis and typechecking without emitting
  files. Source aliases can cross package boundaries without `rootDir` errors;
  build configs retain the existing `dist/<package>` layout.
- Updated build targets, bootstrap ownership metadata, and contributor guidance.
- TypeScript 6 and 7 workspace typechecks, ESLint, and all **270 tests passed**.
  An isolated bootstrap without `dist` or `.isox` built all seven packages and
  verified their entry points, executor manifests, schemas, and CLI startup.

Foundation implementation: 2026-10-26.

- Discovery uses root/nested `.gitignore` rules and a root `.isoxignore` for
  additional exclusions. It does not follow symlinks or enter independent nested
  workspaces, dependency installations, Git internals, or its own cache.
- Cache format 12 stores definitions and declared dependencies only. Ordinary
  commands load it directly until reset, without scanning or fingerprinting source
  files. Dependency graphs are inferred in memory when requested; affected
  selection requests the full graph, while the JS builder requests its dependency
  closure for alias remapping. Only these requests check or populate per-project
  results in `.isox/discovery.json`, validating source metadata and resolution probes.
  Invalid entries reanalyze all included sources of that project; valid entries
  reuse dependency lists. This caches analysis, not task results.
- Shell cancellation and Nx graph cancellation now have descendant regressions;
  Nx uses the shared process-tree cancellation helper. Cooperative stream cleanup
  and POSIX signal exit-status coverage are retained.
- Real packed CLI/core local and global installation checks run from a temporary
  external workspace. The Node 24/26 Linux/macOS/Windows foundation matrix is part
  of the PR and merge-group aggregate check. Its first hosted run is still pending.
- Removed the planned Nx webpack/package-generation CI fixture at the user's
  request. The adapter's unit/contract tests remain; no new Nx compatibility claim
  is made.
- Local macOS validation: package builds, TypeScript 7 typecheck, package lint,
  workflow validation with actionlint 1.7.12, and documentation build/link checks
  passed. Node 24.19.0 passed all ten package/workspace/end-to-end suites (424
  tests across the final successful runs). Node 26.12.1 passed core/CLI/Nx and
  packed installations (254 tests, including concurrent logger/progress tests).
- Parallel validation exposed the semver suite's default five-second timeout and
  a temporary Git-repository teardown race. Semver now uses the same 30-second
  integration timeout as other packages; release fixtures disable automatic Git
  maintenance. The affected suites passed after these changes.
