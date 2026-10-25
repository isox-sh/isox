# CLI reference

[Documentation index](README.md)

## Commands

| Command | Behavior |
| --- | --- |
| `isox init` | Create `isox.json` in the current directory |
| `isox init <package> <path> [--importPath=<name>]` | Scaffold a project using an installed package inside an existing workspace |
| `isox <command> <project>` | Run a project's configured command |
| `isox run <project>:<command>` | Alternative syntax, including commands named `init`, `run`, or `reset` |
| `isox reset` | Remove `.isox`; the next command rebuilds discovery data |
| `isox --help` | Show usage |

Use `--verbose` for debug logging and error stacks. Arbitrary executor options
are configured in `project.json`; the CLI does not forward unknown flags.

## Named configurations

Commands can define named option overrides in `configurations` and select a
fallback with `defaultConfiguration`. For example, a command definition can be:

```json
{
  "executor": "@isox-sh/core:run-command",
  "options": {
    "command": "node scripts/build.js",
    "cwd": "."
  },
  "defaultConfiguration": "development",
  "configurations": {
    "development": {},
    "production": { "command": "node scripts/build.js --production" },
    "staging": { "command": "node scripts/build.js --staging" }
  }
}
```

Use your own build script and select a configuration with:

```bash
isox build my-app --prod
isox build my-app --config=staging
isox run my-app:build --configuration production
isox build my-app -c staging
```

`--prod` selects `production`. `--config`, `--configuration`, and `-c` are aliases;
an explicit name takes precedence over `--prod`, then `defaultConfiguration`
applies if neither selects a name. Without any selection or default, only base
options are used. An unknown configuration fails with an error.

Options are merged at the top level: `{ ...options, ...configurations[name] }`.
Nested objects and arrays are replaced rather than recursively merged. This
works with native and Nx executors, including automatically migrated Nx project
files. The source configuration and workspace cache retain their original values;
the selected options are computed for each invocation. Only one configuration
can be selected per invocation. Other executor CLI flags are not forwarded.

## Workspace cache

Isox stores discovered projects in `.isox/workspace.json`. After adding, changing,
renaming, or removing project files, run `isox reset`. The cache stores project
configuration, not build outputs or task results.

See [workspace configuration](configuration.md) for discovery details and
[Nx migration](nx-migration.md) for temporary adapter support.

## Current scope

Dependency scheduling, affected-project selection, task-result caching, parallel
or distributed execution, and isolation are planned. Declaring `dependencies`
does not schedule prerequisite builds today; use package-manager scripts for
ordering. See the [roadmap](../ROADMAP.md).
