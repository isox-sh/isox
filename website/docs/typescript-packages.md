---
title: "TypeScript package generation"
description: "Generate publishable manifests and reuse packaging helpers in plugins."
icon: "box"
---

Enable `generatePackageJson` on a `js:tsc` target to create a distributable package in its output directory. Add `generateExportsField` when you also want inferred exports.

## Generated packages

The project `package.json` is optional. When present, it must contain `name` and
`version`. Otherwise, generation uses the Isox project name and workspace root
version (or `0.0.0` when the root has no version).
It preserves package metadata and production/optional/peer dependencies, strips
scripts, development dependencies, workspace and package-manager settings, and
infers runtime dependencies from the project's compiled sources. Source metadata
is never rewritten. Existing
`main`, `module`, `types`/`typings`, `bin`, `exports`, and type-version
paths are translated and checked against generated output. Existing exports win
when additional subpaths are merged. Conditional root exports cannot be merged
with additional subpaths until expressed as a subpath map.

For ordinary packages without explicit entry points, emitted `index.js`,
`index.mjs`, or `index.cjs` and corresponding declarations supply defaults.
Declarations emitted into a separate `declarationDir` are copied under `types/`
in the distributable package, with declaration-map paths adjusted. Explicit and
wildcard declaration exports are rewritten to that location.

### Plugin registries and workspace versions

For plugins, the executor copies and rewrites the registries referenced by
`executors` and `generators` (usually `executors.json` and `generators.json`) and
their schemas, preserving implementation paths without creating a root entry
point. Package-local README, license, and notice files are included when present.
`workspace:*`, `workspace:^`, and `workspace:~` become publishable versions using
package manifests of discovered Isox projects. Workspace aliases and
relative workspace references are supported; unresolved packages or unsupported
workspace ranges fail. Projects without manifests use their Isox names and the
workspace version for these references. Lockfiles are not generated.

### Dependency detection

Dependency detection parses TypeScript and JavaScript syntax. Default, named,
namespace, and side-effect imports, runtime re-exports, literal `import()`,
`require()`, and `require.resolve()` calls count. Module-local
`createRequire(__filename)` and `createRequire(import.meta.url)` calls are also
recognized, including aliases. A require created for another package's path is
not treated as this project's dependency; neither are `require.resolve` calls
with explicit lookup options for another workspace. Computed module names cannot
be inferred.

This package-generation analysis uses the build's source inputs and its own
runtime/type classification. It does not substitute the project dependency lists
from `discovery.json` for the dependencies written to the published manifest.

`import type`, `export type`, inline type-only bindings, and `import()` type
expressions add dependencies only for local workspace packages, so published
declarations can resolve their workspace types. External type-only packages are
not inferred. Mixed imports count when they have a runtime
binding. Declaration files, comments, ordinary strings, Node builtins, relative
imports, self-imports, and path aliases resolved within the project are excluded.

### Dependency versions

Existing project runtime, optional, and peer declarations keep their ranges and
classification. For newly detected packages, versions come first from the
project manifest, then the workspace root manifest (including `devDependencies`),
then matching Isox workspace projects. Scoped subpaths collapse to their package
name, and npm aliases are preserved. For example,
`createRequire(__filename).resolve('@typescript/native/package.json')` adds
`@typescript/native` using its root-manifest alias even when the project has no
manifest entry. Missing versions fail generation with an actionable error.

### Output and failures

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

## Reusing package generation in plugins

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

[Back to TypeScript](/docs/typescript).
