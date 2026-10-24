# Isox

A lightweight monorepo command runner with explicit project configuration.
Define commands in `project.json`, mark your workspace with `isox.json`, and run
`isox build web` from anywhere inside it.

[Website](https://isox.sh) · [Source](https://github.com/isox-sh/isox) ·
[Issues](https://github.com/isox-sh/isox/issues)

## Requirements

Node.js 24+. Use your existing npm, pnpm, or Yarn workspace.
Isox runs one project command at a time and does not require a background daemon.

## Install

Install the CLI in your workspace. Its core dependency is installed automatically:

```sh
npm install --save-dev isox
npx isox init
```

With pnpm, use `pnpm add -Dw isox` at the workspace root, then
`pnpm exec isox init`.

`init` creates `isox.json` with the installed CLI's version and never overwrites
an existing file. The nearest ancestor containing this file is the workspace
root. Add `.isox/` to `.gitignore`.

For a global CLI installation:

```sh
npm install --global isox
```

The built-in `@isox-sh/core:run-command` executor is available with both local and
global CLI installations, including pnpm's isolated dependency layout. A directly
installed workspace copy of core takes precedence. Other executor packages still
need to be installed in the workspace.

## Define a project

For an existing npm workspace named `@example/web` with a `build` script, create
`apps/web/project.json`:

```json
{
  "name": "web",
  "dependencies": [],
  "commands": {
    "build": {
      "executor": "@isox-sh/core:run-command",
      "options": {
        "command": "npm run build --workspace @example/web"
      }
    }
  },
  "tags": []
}
```

Replace the shell command with your own tool or package-manager script, then run:

```sh
npx isox build web
```

The project's root is the directory containing `project.json`. Its name defaults
to that directory's name when omitted. `dependencies` and `tags` are optional.
Additional project and command properties are preserved for your own tools.
For editor schema completion or direct imports of core APIs/types, optionally
install `@isox-sh/core` as a direct dependency and reference its
`schemas/project.schema.json`. This is not required to run built-in commands.

Commands run from the workspace root by default. Set `options.cwd` on
`run-command` to choose another directory. Shell commands inherit environment
variables and terminal streams; a nonzero exit fails the command. Avoid scripts
that call the same Isox command recursively.

## CLI commands

| Command | Behavior |
| --- | --- |
| `isox init` | Create `isox.json` in the current directory |
| `isox <command> <project>` | Run a project's configured command |
| `isox run <project>:<command>` | Alternative syntax, including commands named `init`, `run`, or `reset` |
| `isox reset` | Remove `.isox`; the next command rebuilds discovery data |
| `isox --help` | Show usage |

Use `--verbose` for debug logging and error stacks. Arbitrary executor options
are configured in `project.json`; the CLI does not forward unknown flags.

## Configurations

A command can define named option overrides:

```json
{
  "executor": "@isox-sh/core:run-command",
  "options": {
    "command": "npm run build --workspace @example/web"
  },
  "configurations": {
    "production": {
      "command": "npm run build:production --workspace @example/web"
    }
  }
}
```

```sh
isox build web --prod
isox build web --config=production
isox run web:build --configuration production
```

`-c` is another configuration alias. An explicit configuration takes precedence
over `--prod`; otherwise a command's `defaultConfiguration` is used when present.
Options are merged shallowly: nested objects and arrays are replaced. Unknown
configurations fail before execution.

## Workspace cache

Isox stores discovered projects in `.isox/workspace.json`. After adding, changing,
renaming, or removing project files, run `isox reset`. The cache stores project
configuration, not build outputs or task results.

## Migrating from Nx

The temporary Nx adapter supports **Nx 23 only** and exists for initial migration
and evaluation. `init` adds `"nx": { "executors": ["@nx"] }` when the current
workspace root contains `nx.json`. For existing markers, add that setting manually.

Project files that reference a recognized Nx schema are converted in memory:
`targets` becomes `commands`, and `implicitDependencies` becomes `dependencies`.
Source files are not rewritten. Inferred targets and workspace defaults still
need explicit migration. The adapter uses the installed Nx 23 graph builder for
executor dependency metadata, but does not run Nx's task scheduler.

Once you adopt Isox, migrate retained Nx executors and configuration helpers to
native Isox commands and underlying tools, then remove unused Nx dependencies
and adapter settings. See the
[migration guide](https://github.com/isox-sh/isox/blob/main/docs/prompts/migrate-nx-to-isox.md).

## Current scope

Dependency scheduling, affected-project selection, task-result caching, parallel
or distributed execution, and isolation are planned. Declaring `dependencies`
does not schedule prerequisite builds today; use package-manager scripts for
ordering. See the [roadmap](https://github.com/isox-sh/isox/blob/main/ROADMAP.md).

## License

MIT.
