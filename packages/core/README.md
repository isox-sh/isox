# @isox-sh/core

Workspace discovery, native command execution, configuration types, and logging
for [Isox](https://isox.sh). This package also supplies the built-in `run-command`
executor and JSON schemas.

For the command-line interface, install [`isox`](https://www.npmjs.com/package/isox).
Requires Node.js 24+.

## Install

```sh
npm install --save-dev @isox-sh/core
```

Install core directly when importing its APIs/types or referencing its schemas.
For CLI usage, `npm install --save-dev isox` installs core automatically, including
the built-in `@isox-sh/core:run-command` executor. A direct workspace installation
of core takes precedence over the CLI's copy when resolving commands.

## Shell-command executor

Add a command to a project's `project.json`:

```json
{
  "name": "web",
  "commands": {
    "build": {
      "executor": "@isox-sh/core:run-command",
      "options": {
        "command": "npm run build",
        "cwd": "apps/web"
      }
    }
  }
}
```

Run `isox build web`. The shell command inherits the environment and standard
streams. `cwd` is optional and resolves relative to the workspace root; an
absolute path is also accepted. A nonzero exit or termination fails the task.

## Core API

```typescript
import { findWorkspaceRoot, logger, parseWorkspace, runExecutor } from '@isox-sh/core'

async function main() {
  const root = await findWorkspaceRoot()
  const workspace = await parseWorkspace(root)
  await runExecutor(workspace, 'web', 'build', root, logger)
}

main().catch(error => {
  logger.error(error)
  process.exitCode = 1
})
```

`runExecutor` optionally accepts a configuration name as its sixth argument.
Named overrides are merged shallowly over the command's base options. Executors
receive the merged options and a native `ExecutorContext` containing project,
command, workspace, root paths, configuration name, verbosity, and logger.
Context project/command records retain the original configuration.

Use `resetWorkspace()` to remove the detected workspace's `.isox` directory.
Discovery reads cached project configuration until reset; this is not task-result
caching.

## Custom executors

```typescript
import type { Executor } from '@isox-sh/core'

const check: Executor<{ message: string }> = (options, context) => {
  context.logger.info(options.message)
  return { success: true }
}

export default check
```

First-party executor names may omit the scope, such as `core:run-command` or
`js:tsc`, or `vitest:test`. Isox prefers the package under `@isox-sh/`, then
tries the unscoped package if the first-party package is absent.

Native executor packages declare a `commands` manifest path in `package.json`.
The manifest contains a `commands` map whose entries specify an `implementation`
path relative to the manifest. A module exports a callable function or a default
function. Executors may return a result, a promise, or an async iterable of
results; every result must have `success: true`.

## Types, schemas, and logging

Core exports `ProjectDefinition`, `ProjectConfiguration`, `CommandConfiguration`,
`WorkspaceGraph`, `Executor`, `ExecutorContext`, and result/logging types.
Project and command definitions accept custom properties.

Schemas ship at:

- `@isox-sh/core/schemas/project.schema.json`
- `@isox-sh/core/schemas/isox.schema.json`
- `@isox-sh/core/schemas/run-command.json`

Use `logger` or `createLogger` for `debug`, `info`, `success`, `warn`, and `error`
messages. Custom reporters and log levels are supported without an external
logging dependency.

## Scope and migration

Native Isox execution currently runs one command at a time. Project dependencies
are metadata; scheduling, affected detection, task caching, and sandboxing are
planned. Shell execution is not isolated.

The optional Nx adapter supports Nx 23 only, for initial migration. Adopt native
Isox commands before completing migration. See the
[project documentation](https://github.com/isox-sh/isox#readme) and
[roadmap](https://github.com/isox-sh/isox/blob/main/ROADMAP.md).

## License

MIT.
