---
title: "TypeScript build options"
description: "Configure compilation, assets, output cleanup, and watch mode."
icon: "code"
---

Set compiler options in tsconfig and executor options on the Isox target. For installation and a first build, see [TypeScript](/docs/typescript).

## Build behavior and options

### Compiler configuration

Emitted JavaScript files with a shebang (such as `#!/usr/bin/env node`) are
marked executable after each build, so locally linked CLI binaries remain
runnable after rebuilding.

The executor uses its own TypeScript 7 dependency under `@typescript/native`.
It runs without a shell and streams diagnostics. Compiler settings stay in your
tsconfig, including inherited `outDir`, `rootDir`, module format, declarations,
and source maps. `noEmitOnError` is always enabled. Emitting builds require an
`outDir` inside the workspace, separate from sources and other project roots;
`noEmit` configs can run without one. `outFile` is unsupported.

### Workspace dependencies

Workspace TypeScript `paths` can point directly to other projects' source files.
For dependencies in the workspace graph, the executor creates a temporary config
under `.isox/tsc/` that remaps these aliases to their built declarations, using
each dependency's `rootDir` and `declarationDir` (or `outDir`). Exact aliases and
wildcard subpaths are supported; aliases within the current project keep using
source files. The original configs stay unchanged, so editors navigate to source.
The temporary config is removed after compilation, including failed builds.

Alias remapping requests dependency analysis for this project and its transitive
dependencies. It validates and reuses per-project entries in
`.isox/discovery.json`; a valid entry avoids parsing imports again. An included
source-file edit, including a body or comment edit, invalidates that project's
source fingerprint and causes its included sources to be reanalyzed. Unchanged
dependency projects can reuse their entries. Configuration and resolution changes
can also invalidate analysis.

The dependency source set includes tests and other discovered JS/TS files owned
by the project, not only the build's `tsconfig` inputs. Ignore rules and configured
compiler outputs still apply. Dependency-cache reuse alone does not skip compilation. Targets with `cache: true`
can additionally restore a matching task result without invoking the compiler. See [dependency caching](/docs/discovery-cache#discovery-cache)
for validation costs and examples.

Build dependencies with declarations enabled before building their consumers.
A multi-project stage with cached outputs orders the projects already selected,
but does not add missing prerequisite builds by itself. Configure
`dependsOn: ["^build"]` on the build target to include dependency builds. See
[execution ordering](/docs/github-actions#execution-ordering). Dependency configs come from the
same command's `tsConfig` option (falling back to `build`, then the project's
`tsconfig.json`). A matching named configuration takes precedence over the
dependency's default configuration. Watch mode also monitors dependency output
files, so new declarations trigger a rebuild after dependencies are compiled.

### Executor options

| Option | Default | Meaning |
| --- | --- | --- |
| `tsConfig` | Project's `tsconfig.json` | Workspace-relative or absolute config path |
| `clean` | `true` | Remove stale, unchanged files recorded by previous compilations |
| `assets` | `[]` | Asset patterns with `input`, `glob`, optional `output`, and `ignore` |
| `generatePackageJson` | `false` | Generate a distributable manifest in `outDir` |
| `generateExportsField` | `false` | Add inferred root and configured subpath exports |
| `additionalEntryPoints` | None | Map export subpaths to output-relative paths or condition maps |
| `watch` | `false` | Keep rebuilding after input changes |
| `pollInterval` | `500` | Watch snapshot interval in milliseconds, from 100 to 60000 |

Unknown options fail with a migration error. Nx `main`, `outputPath`, `rootDir`,
and transformer options are not accepted as executor options: move compiler
settings into tsconfig and explicitly migrate packaging requirements.

### Output cleanup

Cleanup records content hashes in `.isox/tsc/`. It removes only unchanged files
owned by previous compilations, including compilations whose later packaging step
failed. Unrelated files and user-modified stale
files remain. `clean: false` retains stale output; enabling cleanup later removes
it. Symlinked output paths and overlapping project output ownership are rejected.
Output directories are reserved before compilation, including when projects are
built concurrently for the first time.
Changing an output directory does not delete the former directory. `isox reset`
also discards ownership records, so existing untracked output is preserved.
A stale build lock or output reservation after a forced process kill can be removed with `isox reset`
once no builds are running.

For targets with `cache: true`, core's [output ownership contract](/docs/cache-outputs#output-ownership-and-recovery)
takes precedence: declared directories are replaced as a whole, including with
`clean: false` or `--skip-cache`. Recover any interrupted-task backups before reset.

### TypeScript state files

Files in `.isox/tsc/` support output cleanup and concurrent builds. They do not let Isox
skip a task whose outputs are already present. Keep `.isox/` out of version control.

| File | Purpose |
| --- | --- |
| `<hash>.json` | Records the project and config paths, output roots, and content hashes of owned files |
| `<hash>.json.lock` | Prevents simultaneous builds of the same project |
| `<hash>.json.claim` | Reserves output roots while a build is in progress |
| `<hash>.json.tsbuildinfo` | Compiler build information for incremental or composite configs; recreated for complete output tracking |
| `config-*/tsconfig.json` | Temporary config mapping source aliases to dependency declarations; removed after compilation |

The hash identifies the project's absolute root path. The JSON state lets cleanup
remove stale output only when its content still matches the recorded hash. Locks
and claims are removed when the build finishes, including normal failure cleanup.
Do not edit these files by hand. After a forced stop, see
[stale build locks](/docs/troubleshooting#a-typescript-output-lock-remains-after-a-forced-stop).

### Assets

Asset `input` paths resolve from the workspace root. `output` paths resolve from
`outDir`; `glob` and `ignore` patterns resolve from `input`. Assets cannot escape
these directories, follow symlinks, or overwrite compiler/generated package files.
The executor excludes its output roots, `.git`, `.isox`, and `node_modules` from
asset discovery. `noEmit` cannot be combined with assets or package generation.

```json
{
  "executor": "js:tsc",
  "options": {
    "tsConfig": "packages/web/tsconfig.build.json",
    "assets": [
      { "input": "packages/web/assets", "glob": "**/*", "output": "assets", "ignore": ["**/*.draft"] }
    ],
    "generatePackageJson": true,
    "generateExportsField": true,
    "additionalEntryPoints": {
      "./feature": { "types": "./feature.d.ts", "default": "./feature.js" }
    }
  },
  "configurations": {
    "watch": { "watch": true }
  }
}
```

## Watch mode

Run `isox build web --watch`, or use `isox build web --config=watch` for the
configuration above. The CLI forwards `--watch` as the executor's `watch: true`
option. Watch mode runs a daemon-free rebuild loop,
using content snapshots and complete TypeScript 7 compilations rather than the
compiler's terminal watch messages. It refreshes compiler configuration each
cycle and detects source additions/deletions, assets, package metadata, workspace
package versions, and extended tsconfig changes. Workspace files are sampled;
changes in unrelated projects can also trigger a rebuild. Dependency installation
and external imported files outside the workspace are not actively watched.

Each cycle emits `{ success, continuous: true }`. Compiler and packaging errors
are recoverable; the watcher stays alive so corrections can rebuild. Invalid
executor options and process launch failures stop the command. Generated output
and common cache directories are excluded to prevent rebuild loops. Incremental
build information is kept in `.isox/tsc/` and refreshed for complete output tracking;
watch mode does not reuse a persistent incremental compiler process.

SIGINT/SIGTERM, an executor context's `AbortSignal`, and iterator cancellation
stop polling and active compiler process groups. CLI interruption exits with 130
or 143. Core reports each rebuild without logging final completion while watching.
Declare `dependsOn: ["^build"]` to build dependencies before starting the watcher,
or build them explicitly. Prerequisites must be finite builds; do not forward
`watch: true` to them.

[Back to TypeScript](/docs/typescript).
