---
title: "TypeScript executor"
description: "Scaffold and compile TypeScript projects with assets, package generation, and watch mode."
sidebarTitle: "TypeScript"
icon: "code"
---

Native TypeScript 7 compiler executor for Isox. Requires Node.js 24+.

## Install

Install the plugin in your workspace:

```sh
npm install --save-dev @isox-sh/js
```

The plugin includes its compiler. A separate TypeScript installation is only
needed for your own `tsc` invocations or other tools that import TypeScript.

## Usage

Create a project inside an existing Isox workspace:

```sh
isox init @isox-sh/js packages/test --importPath=@org/test
isox build test
```

The initializer creates `project.json` with a build command and a `$schema`
reference (local when core is installed directly, otherwise a versioned unpkg URL),
`tsconfig.build.json` for compilation, and `src/index.ts` in the project.
A single workspace-root `tsconfig.json` provides editor settings for all projects;
initialization adds each project's sources to its `include` list. It sets
`noEmit: true`, disables composite mode, and uses the workspace as `rootDir`, so
imports of other projects' sources work before a build. Existing comments,
references, includes, and unrelated settings are preserved.
The root editor config extends `tsconfig.base.json` unless it already has an
`extends` setting. Each build config extends `tsconfig.base.json` directly,
enables emit, and keeps `rootDir: "./src"`. The base config is created if missing.
The generated `outDir` mirrors the project's workspace-relative path under the
workspace's `dist/` directory. For example, `packages/test` builds into
`<workspace>/dist/packages/test`, with JavaScript and declarations there.
The initializer also registers missing `js:tsc` defaults in `isox.json`:

```json
{
  "targetDefaults": {
    "js:tsc": {
      "cache": true,
      "outputs": ["{workspaceRoot}/dist/{projectRoot}"]
    }
  }
}
```

Existing values, including `cache: false`, scoped keys and custom output settings,
are preserved. If existing defaults use a different output layout, the new
project gets a local `outputs` override matching its generated `outDir`.
These defaults apply to every matching target in the workspace.
Projects with another `outDir` must override `outputs` to match, including any
separate `declarationDir`. Defaults do not change TypeScript compiler settings.
See [target defaults](/docs/configuration#target-defaults) and [task caching](/docs/task-caching).

The optional `--importPath` adds `compilerOptions.paths["@org/test"]` pointing to
the new entry point, preserving existing settings, aliases, and JSONC comments.
An existing `baseUrl` is respected when computing the mapping.

If TypeScript is installed and `tsc` is available on your `PATH`, run
`tsc --project tsconfig.json` to typecheck without emitting files.
The executor's private compiler does not provide a shell-level `tsc` command.
Use `isox build test` to compile it; build any dependencies first so the executor
can use their declarations.

The `workspace-tsconfig` migration moves unchanged editor configs from older
initializations to the root and adds missing project `$schema` references.
Customized local configs and existing schema references are retained.

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
        "tsConfig": "apps/web/tsconfig.build.json"
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

See [Build behavior and options](/docs/typescript-builds#build-behavior-and-options).

### TypeScript state files

See [TypeScript state files](/docs/typescript-builds#typescript-state-files).

### Assets

See [Assets](/docs/typescript-builds#assets).

## Generated packages

See [Generated packages](/docs/typescript-packages#generated-packages).

## Watch mode

See [Watch mode](/docs/typescript-builds#watch-mode).

## Reusing package generation in plugins

See [Reusing package generation in plugins](/docs/typescript-packages#reusing-package-generation-in-plugins).
