---
title: "TypeScript executor"
description: "Scaffold and compile TypeScript projects with assets, package generation, and watch mode."
sidebarTitle: "TypeScript"
icon: "code"
---

Native TypeScript 7 compiler executor for Isox. Requires Node.js 24+.

## Usage

Create a project inside an existing Isox workspace:

```sh
isox init @isox-sh/js packages/test --importPath=@org/test
isox build test
```

Install `@isox-sh/js` in the workspace first. The initializer creates
`project.json` with a build command, `tsconfig.json` for editors,
`tsconfig.build.json` for compilation, and `src/index.ts`. Both configs extend
the workspace's `tsconfig.base.json`, which is created if missing.
The editor config sets `noEmit: true`, disables composite mode, and uses the
workspace as `rootDir`, so imports of other projects' sources work before a build.
The build command explicitly selects `tsconfig.build.json`, which enables emit
and keeps `rootDir: "./src"`. Existing workspace `tsconfig.json` files are preserved.
The generated `outDir` mirrors the project's workspace-relative path under the
workspace's `dist/` directory. For example, `packages/test` builds into
`<workspace>/dist/packages/test`, with JavaScript and declarations there.
The optional `--importPath` adds `compilerOptions.paths["@org/test"]` pointing to
the new entry point, preserving existing settings, aliases, and JSONC comments.
An existing `baseUrl` is respected when computing the mapping.

Run `tsc --project packages/test/tsconfig.json` to typecheck the generated project
without emitting files. Use `isox build test` to compile it; build any dependencies
first so the executor can use their declarations.

The workspace must already contain `isox.json` (created by plain `isox init`).
Relative project paths resolve from the current directory; absolute paths must
also stay inside the workspace. The destination must not exist. Project names
default to the destination directory name; duplicate names and existing import
aliases are rejected. New projects are immediately available to Isox commands.

Install `@isox-sh/js` in your workspace, then define a project command:

```json
{
  "name": "web",
  "targets": {
    "build": {
      "executor": "@isox-sh/js:tsc",
      "options": {
        "tsConfig": "apps/web/tsconfig.json"
      }
    }
  }
}
```

The executor can also be written as `js:tsc`. The first-party
`@isox-sh/js` package is checked before an unscoped package named `js`.

Run `isox build web`. `tsConfig` resolves relative to the workspace root; absolute
paths also work. When omitted, it defaults to `tsconfig.json` in the project root.
Use the tsconfig for compiler options, inputs, declarations, and output paths.
Named Isox configurations can override `tsConfig`.

## Build behavior and options

Emitted JavaScript files with a shebang (such as `#!/usr/bin/env node`) are
marked executable after each build, so locally linked CLI binaries remain
runnable after rebuilding.

The executor uses its own TypeScript 7 dependency under `@typescript/native`.
It runs without a shell and streams diagnostics. Compiler settings stay in your
tsconfig, including inherited `outDir`, `rootDir`, module format, declarations,
and source maps. `noEmitOnError` is always enabled. Emitting builds require an
`outDir` inside the workspace, separate from sources and other project roots;
`noEmit` configs can run without one. `outFile` is unsupported.

Workspace TypeScript `paths` can point directly to other projects' source files.
For dependencies in the workspace graph, the executor creates a temporary config
under `.isox/tsc/` that remaps these aliases to their built declarations, using
each dependency's `rootDir` and `declarationDir` (or `outDir`). Exact aliases and
wildcard subpaths are supported; aliases within the current project keep using
source files. The original configs stay unchanged, so editors navigate to source.
The temporary config is removed after compilation, including failed builds.

Build dependencies with declarations enabled before building their consumers;
Isox does not schedule prerequisite builds yet. Dependency configs come from the
same command's `tsConfig` option (falling back to `build`, then the project's
`tsconfig.json`). A matching named configuration takes precedence over the
dependency's default configuration. Watch mode also monitors dependency output
files, so new declarations trigger a rebuild after dependencies are compiled.

| Option | Default | Meaning |
| --- | --- | --- |
| `tsConfig` | Project's `tsconfig.json` | Workspace-relative or absolute config path |
| `clean` | `true` | Remove stale, unchanged files recorded by previous compilations |
| `assets` | `[]` | Asset patterns with `input`, `glob`, optional `output`, and `ignore` |
| `generatePackageJson` | `false` | Generate a distributable manifest in `outDir` |
| `generateExportsField` | `false` | Add inferred root and configured subpath exports |
| `additionalEntryPoints` | None | Map export subpaths to output-relative paths or condition maps |
| `watch` | `false` | Keep rebuilding after input changes |
| `pollInterval` | `500` | Watch snapshot interval in milliseconds, minimum 100 |

Unknown options fail with a migration error. Nx `main`, `outputPath`, `rootDir`,
and transformer options are not accepted as executor options: move compiler
settings into tsconfig and explicitly migrate packaging requirements.

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

Asset `input` paths resolve from the workspace root. `output` paths resolve from
`outDir`; `glob` and `ignore` patterns resolve from `input`. Assets cannot escape
these directories, follow symlinks, or overwrite compiler/generated package files.
The executor excludes its output roots, `.git`, `.isox`, and `node_modules` from
asset discovery. `noEmit` cannot be combined with assets or package generation.

```json
{
  "executor": "js:tsc",
  "options": {
    "tsConfig": "packages/web/tsconfig.json",
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

## Generated packages

The project `package.json` is optional. When present, it must contain `name` and
`version`. Otherwise, generation uses the Isox project name and workspace root
version (or `0.0.0` when the root has no version).
It preserves package metadata and production/optional/peer dependencies, strips
scripts, development dependencies, workspace and package-manager settings, and
infers runtime dependencies from the project's compiled sources. Source metadata
is never rewritten. Existing
`main`, `module`, `types`/`typings`, `bin`, `exports`, initializer, and type-version
paths are translated and checked against generated output. Existing exports win
when additional subpaths are merged. Conditional root exports cannot be merged
with additional subpaths until expressed as a subpath map.

For ordinary packages without explicit entry points, emitted `index.js`,
`index.mjs`, or `index.cjs` and corresponding declarations supply defaults.
Declarations emitted into a separate `declarationDir` are copied under `types/`
in the distributable package, with declaration-map paths adjusted. Explicit and
wildcard declaration exports are rewritten to that location.

For command-only plugins, the executor copies and rewrites `executors.json`
and its schemas, preserving implementation paths without creating a root entry
point. Package-local README, license, and notice files are included when present.
`workspace:*`, `workspace:^`, and `workspace:~` become publishable versions using
package manifests of discovered Isox projects. Workspace aliases and
relative workspace references are supported; unresolved packages or unsupported
workspace ranges fail. Projects without manifests use their Isox names and the
workspace version for these references. Lockfiles are not generated.

Dependency detection parses TypeScript and JavaScript syntax. Default, named,
namespace, and side-effect imports, runtime re-exports, literal `import()`,
`require()`, and `require.resolve()` calls count. Module-local
`createRequire(__filename)` and `createRequire(import.meta.url)` calls are also
recognized, including aliases. A require created for another package's path is
not treated as this project's dependency; neither are `require.resolve` calls
with explicit lookup options for another workspace. Computed module names cannot
be inferred.

`import type`, `export type`, inline type-only bindings, and `import()` type
expressions add dependencies only for local workspace packages, so published
declarations can resolve their workspace types. External type-only packages are
not inferred. Mixed imports count when they have a runtime
binding. Declaration files, comments, ordinary strings, Node builtins, relative
imports, self-imports, and path aliases resolved within the project are excluded.

Existing project runtime, optional, and peer declarations keep their ranges and
classification. For newly detected packages, versions come first from the
project manifest, then the workspace root manifest (including `devDependencies`),
then matching Isox workspace projects. Scoped subpaths collapse to their package
name, and npm aliases are preserved. For example,
`createRequire(__filename).resolve('@typescript/native/package.json')` adds
`@typescript/native` using its root-manifest alias even when the project has no
manifest entry. Missing versions fail generation with an actionable error.

Output may live outside the project directory, within the workspace, such as
`<workspace>/dist/<package>`. Executor schemas already supplied as output assets
are reused when generating the manifest. `publishConfig.exports` overrides the
source exports map; its paths are relative to the output package. Build-only
`publishConfig.directory` and `linkDirectory` fields are removed from generated
metadata so the resulting package can be packed directly. Generated manifests
omit `files`, including any allowlist from the source manifest.

Metadata is written atomically after successful compilation and packaging
validation. Type errors preserve previous output and metadata. A packaging error
fails the build even if TypeScript has already emitted updated files.

## Watch mode

Run `isox build web --config=watch` for the configuration above. The CLI does not
forward a standalone `--watch` flag. Watch mode runs a daemon-free rebuild loop,
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
Isox does not schedule dependency builds; build prerequisites explicitly.

In this repository, run `pnpm bootstrap` after installing dependencies to build
core, this executor, and the CLI from a clean checkout. Subsequent builds use
`pnpm isox build js`. Tests live in `packages/js/tests/` and run with
`pnpm isox test js`.

### Reusing package generation in plugins

Import the shared generator from `@isox-sh/js/helpers` (or
`@isox-sh/js/helpers/package-json`). Its `PackageJsonOptions` and
`PackageJsonContext` types are exported from both entry points.

```ts
import { generatePackageJson } from '@isox-sh/js/helpers'

const files = await generatePackageJson(
  { generateExportsField: true },
  context,
  outDir,
  emittedFiles,
  assets,
  declarationDir,
)
```

`emittedFiles` is a set of absolute compiler output paths; `assets` maps absolute
output paths to buffers. The optional `declarationDir` identifies separately
emitted declarations. The returned `Map<string, Buffer>` includes the generated
manifest and supporting package files. Plugins can modify these buffers or add
entries before publishing them. The helper does not write files: the calling
plugin owns output validation, writing, and cleanup.

Pass `tsConfig` (absolute or relative to the workspace root) and optionally
`sourceFiles` (absolute paths) to select sources for dependency detection. The
TypeScript executor supplies these automatically. Without them, the helper uses
the nearest tsconfig; if none exists, it scans emitted JavaScript instead.
