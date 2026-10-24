# Isox goal and active roadmap

## Goal

Build a lightweight monorepo orchestrator with explicit project configuration,
deterministic execution, dependency ordering, affected-project selection, and
reusable task results locally and across CI workers. Keep the native runtime
simple, inspectable, and independent of Nx and background daemons.

This preserves the original blueprint's orchestration goals while reflecting
our decision to use Isox's own contract. Projects use `project.json` with
`dependencies` and `commands`; executor packages expose a `commands.json`
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

Priority follows the numbered milestones. The next implementation milestone is
**1: explicit dependency and task graphs**. Follow-up robustness work in milestone
0 can proceed alongside it. New command names and configuration fields below are
proposals until their schemas and behavior are implemented.

## Current capability boundary

Isox currently discovers projects and executes one selected project command.
`dependencies` is metadata, not a native scheduling graph. Configuration merging
is supported, but `dependsOn`, task inputs/outputs, hashing, affected selection,
parallel execution, and sandboxing are not implemented.

`.isox/workspace.json` caches project configuration only. It does not cache task
results or automatically detect project-file changes; use `isox reset` to refresh
it. The Nx adapter's inferred graph and separate Nx file-map cache serve migration
executors only and do not implement the native roadmap.

## 0. Foundation and current implementation

- [x] Bootstrap a pnpm workspace with TypeScript 7 builds and separate core/CLI packages.
- [x] Compile repository packages through `@isox-sh/js:tsc` project commands, with a clean-checkout bootstrap and no package build scripts.
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
- [x] Configure CI to build, lint, and run all package test suites through the bootstrapped CLI.
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

- [ ] Validate dependency references and report cycles with the complete cycle path.
- [ ] Build forward and reverse project edges with deterministic ordering and safe handling of isolated projects.
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

- [ ] Define base/head selection and use their merge base for committed changes; report missing refs and shallow-history failures clearly.
- [ ] Decide how staged, unstaged, and untracked changes participate, with explicit local/CI behavior.
- [ ] Map changed paths to the most specific project root; handle root-level projects, deletions, renames, spaces, and unusual filenames.
- [ ] Define workspace-wide inputs such as root configuration and lockfiles, and how unmatched files affect selection.
- [ ] Include transitive dependents and filter for the requested command without losing required prerequisite tasks.
- [ ] Add affected execution and a planning-only JSON interface, tentatively `isox print-affected --command=build --base=origin/main`.
- [ ] Keep JSON stdout free of logs, including cache diagnostics; return a stable empty result when nothing is affected.
- [ ] Test using temporary Git repositories with branching history, nested project roots, and renamed/deleted files.

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

The original GitHub Actions matrix idea remains a goal. A JSON project list
supports fan-out, but dependency ordering and artifact transfer still need an
explicit design; a matrix alone is not a distributed scheduler.

- [ ] Define stable task-plan JSON suitable for matrix consumers, including selected configurations and task prerequisites.
- [ ] Add examples for GitHub Actions and evaluate integration with existing `nx-extend/actions` workflows without requiring Nx at runtime.
- [ ] Define execution waves or worker-side prerequisite handling so dependent builds do not race.
- [ ] Integrate remote results or artifact transfer between jobs, with deterministic retry/failure aggregation.
- [ ] Handle empty task sets, matrix limits, cancellation, and worker concurrency.
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
