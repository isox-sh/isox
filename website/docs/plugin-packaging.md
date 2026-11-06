---
title: "Plugin layout and packaging"
description: "Organize plugin implementations, copy schemas, and publish package registries."
sidebarTitle: "Layout and packaging"
icon: "box"
---

## Plugin layout

Use this layout for a plugin that provides executors, generators, and migrations.
Include only the registries and implementation directories your plugin needs:

```text
packages/<plugin>/
├── package.json
├── executors.json
├── generators.json
├── migrations.json
├── project.json
├── src/
│   ├── executors/
│   │   └── lint/
│   │       ├── lint.executor.ts
│   │       └── lint.schema.json
│   ├── generators/
│   │   └── init.ts
│   ├── migrations/
│   │   └── rename-build-option.ts
│   └── helpers/
└── tests/
```

Each executor lives in `src/executors/<name>/`. Name its implementation
`<name>.executor.ts` and keep its options schema beside it as
`<name>.schema.json`. For example, ESLint uses `lint.executor.ts` and
`lint.schema.json`; TypeScript uses `tsc.executor.ts` and `tsc.schema.json`.
Keep executor-specific helpers in the same folder. Shared plugin helpers belong
in `src/helpers`; export them through package entry points when other plugins
need to reuse them. Project initializers and add generators belong in `src/generators`,
migration scripts belong in `src/migrations`, and tests stay inside the owning package's `tests` directory.

Executor-only plugins do not need `src/index.ts` or package `main`/`types`
entries. These are repository conventions; external plugins can choose another
layout because Isox loads the paths declared in their manifests.

## Building and packaging schemas

TypeScript compilation does not copy standalone JSON schemas. Configure
[`js:tsc` assets](/docs/typescript) in the plugin's `project.json` to preserve their
paths under `dist`:

```json
{
  "name": "my-plugin",
  "targets": {
    "build": {
      "executor": "js:tsc",
      "options": {
        "tsConfig": "packages/my-plugin/tsconfig.build.json",
        "assets": [
          {
            "input": "packages/my-plugin/src",
            "glob": "executors/**/*.schema.json"
          }
        ]
      }
    }
  }
}
```

With `rootDir: "./src"` and `outDir: "./dist"` in the package's tsconfig, this
produces `dist/executors/lint/lint.executor.js` and
`dist/executors/lint/lint.schema.json`. Copy any supporting JSON files referenced
by a schema as assets too, preserving their relative paths.

Point both manifest fields at the built files:

```json
{
  "executors": {
    "lint": {
      "implementation": "./dist/executors/lint/lint.executor.js",
      "schema": "./dist/executors/lint/lint.schema.json"
    }
  }
}
```

Publish the build directory and manifest using these `package.json` fields:

```json
{
  "executors": "./executors.json",
  "generators": "./generators.json",
  "migrations": "./migrations.json",
  "files": ["dist", "executors.json", "generators.json", "migrations.json"]
}
```

Omit `generators` or `migrations` and their files when the plugin does not provide
those features. Keep package-level workspace
schemas, such as core's `schemas/project.schema.json`, separate from executor
options schemas.

The layout above describes a plugin with a local `dist` directory. This
repository builds standalone packages into `<repository>/dist/<package>`; see
[repository build outputs](/docs/contributing#build-outputs) for workspace links,
package generation, and bootstrap behavior. In both layouts, executor schemas
are copied through the configured assets.
