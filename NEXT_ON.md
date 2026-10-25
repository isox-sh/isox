# Next: expand the native TypeScript command

Extend `@isox-sh/js:tsc` (`js:tsc`) with safe output management, asset copying,
**package.json generation**, and **watch mode**. Package generation and watch mode
are required parts of this work.

This is the focused executor checklist alongside the broader [roadmap](ROADMAP.md).
The checklist records the implemented contract. Defaults and examples are in the
[TypeScript executor guide](docs/typescript.md). Keep it updated as behavior changes.

## Current behavior and Nx comparison

Our [command](packages/js/src/executors/tsc/tsc.executor.ts) runs TypeScript 7 with
`--project` and forces `noEmitOnError`. Config settings stay in tsconfig. It now
tracks owned output, copies assets, generates distributable package metadata on
request, and provides a daemon-free watch rebuild loop with recoverable errors.

[Nx 23.3.1's executor](https://github.com/nrwl/nx/blob/23.3.1/packages/js/src/executors/tsc/tsc.impl.ts)
also copies assets, generates package metadata, and supports watch mode. Its
[compilation helper](https://github.com/nrwl/nx/blob/23.3.1/packages/js/src/utils/typescript/compilation.ts)
overrides output/root directories, forces `noEmitOnError`, and can clean output.
Nx also uses its project graph to prepare dependency information and temporary
compiler configuration. Isox implements its own output/packaging/watch contract rather than Nx graph
inference or temporary compiler-configuration generation.

Changing an Nx executor name to `js:tsc` alone is insufficient: options such as
`outputPath` are rejected. Asset patterns and cleanup follow the native contract
documented in the TypeScript executor guide; they are not a direct Nx option translation.

## 1. Configuration and output handling

- [x] Define and validate supported command options; reject unsupported options with useful migration errors.
- [x] Keep compiler settings in tsconfig; define how inherited configs, output paths, and declaration directories are resolved.
- [x] Define emission-on-error behavior explicitly, including whether to enforce `noEmitOnError`.
- [x] Add safe output cleanup. Reject deletion of workspace/project roots, source directories, and unsafe paths; account for symlinks and overlapping outputs.
- [x] Remove stale generated files after source files are renamed or deleted without removing unrelated files.
- [x] Add asset copying with explicit input/output patterns, exclusions, and collision handling.

## 2. Package.json generation

- [x] Add a `generatePackageJson` option and document its default.
- [x] Generate the manifest in the resolved output directory without modifying the source manifest.
- [x] Preserve relevant package metadata and dependency declarations; define which development-only fields are omitted.
- [x] Resolve workspace dependency version specifications into publishable values using explicit package declarations.
- [x] Generate or validate `main`, `types`, and optional `exports` entries against emitted files, including additional entry points and ESM/CommonJS packages.
- [x] Support command-only plugins without inventing a root entry point; preserve `commands` metadata and ensure its manifest, implementations, and schemas are included.
- [x] Define behavior for missing source manifests, conflicting user fields, and failed builds; write generated manifests atomically.
- [x] Validate the generated package by packing and installing it in an isolated fixture, including runtime and declaration resolution where applicable.

Lockfile generation is a separate follow-up decision. Package.json generation
must not depend on recreating Nx's dependency inference or task scheduler.

## 3. Watch mode

- [x] Add a `watch` option and document how to select it through project configuration; add CLI forwarding only if explicitly supported.
- [x] Start a long-running TypeScript 7 watcher and expose initial and subsequent compilation results reliably.
- [x] Define how core consumes watch results: it currently throws on any unsuccessful executor result. Recoverable compiler errors must allow the watcher to continue and report later successful builds.
- [x] Distinguish compilation errors from fatal startup/process failures; avoid reporting final task completion while watching continues.
- [x] Refresh copied assets and generated package.json when relevant source files, assets, or package metadata change, without requiring a daemon.
- [x] Handle additions, renames, and deletions, while excluding generated output to prevent rebuild loops.
- [x] Define whether tsconfig changes trigger a reload or watcher restart.
- [x] Handle SIGINT/SIGTERM and consumer cancellation, closing all watchers and child processes without leaving background work running.

## 4. Verification and documentation

- [x] Keep regression tests inside `packages/js/tests`; put runner lifecycle tests inside `packages/core/tests`.
- [x] Cover paths with spaces, extended tsconfigs, failing compilation, stale outputs, asset exclusions, and generated manifests.
- [x] Cover initial watch builds, error-to-success recovery, file deletion, metadata updates, and clean shutdown.
- [x] Update the command schema, TypeScript executor guide, migration prompt, and this checklist with the implemented behavior.
- [x] Exercise clean bootstrapping and builds/tests through Isox itself.

Dependency scheduling remains core roadmap work. Custom compiler transformers
and full Nx option compatibility are outside this checklist.

## Implementation decisions and limits

- `generatePackageJson` and `watch` default to false; `clean` defaults to true and
  removes only unchanged owned files after successful compilation. Resetting
  `.isox` discards ownership rather than authorizing deletion of untracked files.
- Watch mode uses content snapshots (500 ms by default) and complete native
  compiler invocations. It does not depend on localized terminal messages or a
  persistent compiler process. Configuration is reloaded every cycle; compiler
  errors recover, while process launch/termination errors stop the stream.
- Runtime declarations emitted outside `outDir` are copied under `types/` for
  packaging. Command-only plugin metadata and local schema references are copied
  without inventing a root entry point.
- Workspace `*`, `^`, and `~` version specifications, aliases, and relative
  workspace references resolve from explicitly declared project packages.
  Unsupported workspace ranges fail instead of leaking into generated packages.
- Inputs in the workspace are sampled, so unrelated workspace edits may trigger
  a rebuild. Installed dependency internals and imported files outside the
  workspace are not actively watched. Incremental build information is refreshed
  to make output ownership complete on each build.
- Validation includes actual packing/installation for CommonJS and ESM packages,
  declaration resolution, stale-output protection, and cancellation through the
  public runner and CLI. Platform-specific behavior is exercised on the current
  macOS/Node 24 environment; the broader CI platform matrix remains roadmap work.
