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

## Add to an existing project

After installing the plugin, use the **project name** from `project.json`:

```sh
isox add @isox-sh/vitest web
```

The generator adds `test: { "executor": "vitest:test" }` to the project's targets
and registers missing `isox.json` defaults:

```json
{
  "targetDefaults": {
    "vitest:test": {
      "cache": true
    }
  }
}
```

Existing Vitest targets, options, configurations, cache opt-outs and output
settings are preserved. Scoped default keys are recognized without adding a
second shorthand entry. Repeating the command is safe. A different existing
`test` executor is reported as a conflict. The generator does not install packages
or create test files.

Omitting `outputs` caches test results and terminal logs only. If tests generate coverage or
other artifacts, declare those output directories explicitly. If tests read built
files outside their project, include those paths in `inputs` as well. See
[task caching](/docs/task-caching) and [target defaults](/docs/configuration#target-defaults).

## Define a test command manually

```json
{
  "name": "web",
  "targets": {
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

For example, a project can keep its tests under `tests/`:

```js apps/web/vitest.config.mjs
export default {
  test: {
    include: ['tests/**/*.test.mjs'],
  },
}
```

Select a different config for one invocation with:

```sh
isox test web --config-file=apps/web/vitest.integration.config.mjs
```

`--config-file` selects the Vitest file; Isox's `--config` selects a named target
configuration. The executor supports only `configFile` and always runs tests once.
Flags such as `--watch` and `--coverage` are not forwarded to the Vitest CLI.
Configure coverage in the Vitest file, or use a [shell target](/docs/shell-commands)
when you need a different Vitest invocation.
