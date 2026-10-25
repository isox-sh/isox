---
title: "ESLint executor"
description: "Lint project files, apply fixes, and enforce warning limits with eslint:lint."
sidebarTitle: "ESLint"
icon: "list-check"
---

## Install

Requires Node.js 24 or 26+. Install the plugin in your workspace:

```sh
npm install --save-dev @isox-sh/eslint
```

The plugin includes ESLint. Keep your ESLint configuration and any parsers or
rule plugins installed in the workspace.

If your `eslint.config.mjs` imports `eslint/config`, install `eslint` directly too
so that import resolves with package managers that isolate dependencies.

## Define a lint command

```json
{
  "name": "my-app",
  "targets": {
    "lint": {
      "executor": "eslint:lint",
      "options": {
        "maxWarnings": 0
      }
    }
  }
}
```

Run `isox lint my-app`. The fully scoped executor name is
`@isox-sh/eslint:lint`.

Apply automatic fixes from the CLI:

```sh
isox lint my-app --fix
isox run my-app:lint --fix
isox run-many --target=lint --fix
isox affected --target=lint --fix
```

The CLI flag overrides `fix` from the target's options or selected configuration.
Other plugin options work the same way, such as `--max-warnings=5` or
`--config-file=eslint.custom.mjs`; the CLI forwards unrecognized flags to the executor.
For multi-project runs, it applies to the requested target, leaving pre/post
targets' options unchanged. Use `--no-fix` to disable configured fixes for a run.

## Options

| Option | Default | Description |
| --- | --- | --- |
| `lintFilePatterns` | Project root | Non-empty array of files, directories, or globs relative to the workspace root. Absolute paths are also accepted. |
| `configFile` | ESLint discovery | Configuration path relative to the workspace root, or absolute. |
| `fix` | `false` | Apply ESLint's automatic fixes. |
| `maxWarnings` | `0` | Maximum allowed warnings; `-1` allows unlimited warnings. |

ESLint runs from the workspace root, and default linting selects only the current
project. Globs are passed directly to ESLint without shell expansion. Lint errors,
excess warnings, unmatched patterns, and configuration failures fail the command.
Cancellation stops the child process through Isox's shared process runner.

For array-valued options, use JSON to preserve the array even with one pattern:

```sh
isox lint my-app --options '{"lintFilePatterns":["apps/my-app/src/**/*.ts"]}'
```

These options use the corresponding [ESLint CLI options](https://eslint.org/docs/latest/use/command-line-interface).
