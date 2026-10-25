---
title: "Vitest executor"
description: "Run project test suites and select Vitest configuration with vitest:test."
sidebarTitle: "Vitest"
icon: "flask"
---

## Install

Native Vitest 5 test executor for Isox. Requires Node.js 24 or 26+; Vitest does not
support Node.js 25.

Install `@isox-sh/vitest` and `vitest` in your workspace. The executor includes
Vitest to run suites; a direct Vitest development dependency lets your tests
import its APIs and your editor resolve its types.

```sh
npm install --save-dev @isox-sh/vitest vitest
```

## Define a test command

```json
{
  "name": "web",
  "executors": {
    "test": {
      "executor": "vitest:test"
    }
  }
}
```

Run `isox test web`. `@isox-sh/vitest:test` is also supported. First-party
shorthand resolves the Isox executor before looking for an unscoped package.

The executor runs `vitest run` with the project's directory as the root and
working directory. Tests run once, with diagnostics streamed to the terminal.
Failed tests, configuration errors, and empty suites fail the Isox command.
Put Vitest options in your project's `vitest.config.mjs` (or another supported
Vitest config format).

## Select a configuration file

For a custom config location, set `options.configFile` to a workspace-relative
or absolute path. Named Isox configurations can override that path. The project
root remains the same when selecting a different config file.

## Repository development

In this repository, tests stay inside each package's `tests/` directory.
Run `pnpm bootstrap` once, then `pnpm isox test vitest` to test this executor.
`pnpm test` bootstraps and runs all package suites and the end-to-end suite through Isox.
