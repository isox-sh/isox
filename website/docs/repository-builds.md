---
title: "Repository builds"
description: "Build local packages and try the CLI in an isolated workspace."
icon: "hammer"
---

Run these commands from the Isox repository after [development setup](/docs/contributing#development-setup). For your own plugin package, use [plugin packaging](/docs/plugin-packaging).

## Building and running packages

Packages have Isox `project.json` files with `build`, `lint`, and `test` commands.
Run `pnpm bootstrap` once to bootstrap the local CLI, then use Isox itself:

```bash
pnpm isox build core
pnpm isox build js
pnpm isox build cli
pnpm isox build vitest
pnpm isox lint core
pnpm isox lint cli
pnpm isox test core
pnpm isox test cli
pnpm isox test js
pnpm isox test vitest
pnpm isox test nx
```

The syntax is `isox <command> <project>`: `build` is the target, and `cli` is the project.
Any command defined in that project's `targets` object can be used.
`isox run cli:build` also works. `init`, `add`, `run`, `reset`, `affected`, `plan`,
and `run-many` are reserved CLI commands; use `isox run <project>:<command>` for
project commands with those names.

Package builds use [`@isox-sh/js:tsc`](/docs/typescript), written as `js:tsc`
in our project files. Compiler settings stay in each package's `tsconfig.build.json`;
there are no `scripts.build` entries. Lint commands use
[`eslint:lint`](/docs/eslint); test commands use
[`vitest:test`](/docs/vitest).
The root `tsconfig.json` covers all package sources with `noEmit: true`. Editors
use this workspace config without a package-level `rootDir` boundary. Internal
package imports use the root `tsconfig.base.json` paths, which point to the
original sources in `packages/*/src`. Package build configs keep `rootDir: "./src"`
so emitted files stay directly under `dist/<package>`. The `js:tsc` executor creates
a temporary build config that maps dependencies to their compiled declarations. Build
prerequisites first; editor navigation and workspace discovery use the source
aliases without needing a build. Root development
dependencies keep the local plugins available to Node and the CLI; TypeScript
paths do not rewrite emitted imports. Most internal dependencies are inferred
from source imports during package generation. Explicit dependencies remain where code resolves a package by name,
such as the E2E helper's CLI dependency. On-demand dependency analysis infers
project edges, so package project definitions do not duplicate these imports.

For individual build commands, build prerequisites first: core before JS and
the other packages. Multi-project stages with cached outputs order their selected
projects by dependency. This repository's build targets do not declare `dependsOn`,
so their unselected prerequisites still need to be built explicitly. See
[execution ordering](/docs/github-actions#execution-ordering). `pnpm bootstrap` seeds core and the JS executor
with TypeScript, then runs the package build commands through Isox. It also
refreshes project discovery. After editing project definitions, run `isox reset`
before single-project commands. Dependency requests from affected selection or
the TypeScript builder validate `.isox/discovery.json` and reuse valid entries.
Its source fingerprint uses file metadata, so editing a source or test file can
reanalyze that project's included sources on the next request. Commands that need
neither dependencies nor task caching leave this analysis cache alone. Reusing analysis does not itself skip compilation; a task-result
cache hit can. See
[cache behavior](/docs/discovery-cache#discovery-cache).

## Build outputs

All repository packages build into `<repository>/dist/<package>`, including
`dist/core`, `dist/js`, `dist/eslint`, `dist/vitest`, `dist/nx`, `dist/e2e`,
`dist/semver`, and `dist/cli`. These directories contain runnable package artifacts: JavaScript,
declarations, rewritten package manifests, executor manifests, and schemas.
Source files and tests stay under `packages/<package>`.

Each package's `tsconfig.build.json` declares the root output path. Its Isox build
enables `generatePackageJson`, and executor schemas are copied using `assets`. Generated
manifests use paths within the output package and resolve workspace dependency
versions. `publishConfig.directory` selects this output for packaging; pnpm's
`linkDirectory` makes local workspace imports resolve to it after installation.
Run `pnpm install` after changing these settings, then `pnpm bootstrap` before
running the CLI or tests. Publish or globally install the built package directory
when using npm directly. See [trying the local CLI](/docs/repository-builds#trying-the-local-cli) for the
global installation commands.

Bootstrap seeds the metadata and schemas needed to compile core and JS, prepares
shared dependency links under `dist/node_modules`, then rebuilds every package
through Isox. The TypeScript executor tracks ownership of bootstrap metadata so
it can safely replace it during the build. Bootstrap refreshes outdated dependency
links and the workspace discovery cache while retaining output ownership, so
subsequent builds can remove outputs from deleted source files. Build directories
are ignored by Git.

## Plugin source layout

Keep executors in `src/executors/<name>/<name>.executor.ts` and their options
schemas beside them as `<name>.schema.json`. Put project initializers in
`src/generators` and reusable helpers in `src/helpers`. Tests belong to the
package's `tests` directory.

In `packages/<plugin>/executors.json`, reference the compiled implementation and
copied schema under `../../dist/<plugin>/executors/<name>/`. Add executor schemas
to the build's `assets` option and enable `generatePackageJson`. Package generation
copies the manifest and rewrites its paths relative to the output package.
Publish `dist/<plugin>` using `publishConfig.directory`, as described in
[build outputs](/docs/repository-builds#build-outputs). See [plugin layout and packaging](/docs/plugin-packaging#plugin-layout)
for an alternative layout with a package-local `dist` directory.

## Trying the local CLI

After installing dependencies with `pnpm install`, run these commands from the
Isox repository root to build your checkout and install its CLI globally:

```bash
node ./scripts/bootstrap.cjs
npm install -g ./dist/cli --install-links=false
```

To test the published package layout instead of a development link, pack both
packages and install the resulting archives together into an isolated prefix:

```bash
mkdir -p tmp/packed
npm pack ./dist/core ./dist/cli --pack-destination tmp/packed
npm install --global --prefix "$PWD/tmp/installed" ./tmp/packed/*.tgz
# POSIX: add tmp/installed/bin to PATH; Windows uses tmp/installed itself.
```

The package-local integration test automates local and global installation,
checks the installed binary, and runs a core command outside this checkout:

```bash
ISOX_TEST_PACKAGES=1 pnpm isox test cli
```

It needs npm registry access for external dependencies. Both packages are tested
from their actual tarballs; nothing is published and the user's global install
is untouched. The foundation matrix enables this check when that job is re-enabled.

The global `isox` command links to this checkout's built CLI.
[`--install-links=false`](https://docs.npmjs.com/cli/v12/commands/npm-install/#install-links)
keeps the local package linked. After changing source code, rerun
`node ./scripts/bootstrap.cjs` from the repository root to update the build used
by the global command. Executor plugins still resolve from the workspace where
you run Isox. A workspace-installed core also takes precedence over the CLI's
copy, so testing a local CLI alone does not replace that workspace's plugins.

Use it from a workspace containing `isox.json`, `project.json` files, and installed
executor plugins:

```bash
cd /path/to/your/workspace
isox build my-app
```

You can also invoke the built CLI directly:

```bash
cd /path/to/your/workspace
node /path/to/isox/dist/cli/index.js build my-app
```

[Back to contributing](/docs/contributing).
