---
title: "ESLint executor"
description: "Lint project files, apply fixes, and enforce warning limits with eslint:lint."
sidebarTitle: "ESLint"
icon: "list-check"
---

## Install

Install the plugin in your workspace:

```sh
npm install --save-dev @isox-sh/eslint
```

The plugin includes ESLint. Keep your ESLint configuration and any parsers or
rule plugins installed in the workspace.

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

These options use the corresponding [ESLint CLI options](https://eslint.org/docs/latest/use/command-line-interface).
