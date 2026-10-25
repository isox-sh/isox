# CLI reference

[Documentation index](README.md)

## Commands

| Command | Behavior |
| --- | --- |
| `isox init` | Create `isox.json` in the current directory |
| `isox init <package> <path> [--importPath=<name>]` | Scaffold a project using an installed package inside an existing workspace |
| `isox <command> <project>` | Run a project's configured command |
| `isox run <project>:<command>` | Alternative syntax, including commands whose names are reserved by the CLI |
| `isox affected --target=<command>` | Run changed projects and their dependents; add `--print-matrix` for a JSON project array |
| `isox plan --target=<command> --max-jobs=3` | Print an affected, weighted GitHub Actions matrix; use `--all` to select every matching project |
| `isox run-many --target=<command> --projects=core,cli` | Run selected projects with optional `--parallel` |
| `isox reset` | Remove `.isox`; the next command rebuilds discovery data |
| `isox --help` | Show usage |

Use `--verbose` for debug logging and error stacks. Arbitrary executor options
are configured in `project.json`; the CLI does not forward unknown flags.

For `affected`, `plan`, and `run-many`, `--pre-targets` and `--post-targets` accept
comma- or newline-separated command lists. Use `--pre-targets-json` and
`--post-targets-json` for exact arrays, including command names that contain
commas. For example, `--pre-targets-json '["prepare,assets:acc"]'` runs
`prepare,assets` with its `acc` configuration. Do not combine a list flag with its
JSON counterpart. See [affected projects and CI](affected-and-ci.md) for stage ordering.

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
options are used. An unknown configuration fails with an error. Names retain
their exact spelling, including leading zeros in names such as `001`.

Options are merged at the top level: `{ ...options, ...configurations[name] }`.
Nested objects and arrays are replaced rather than recursively merged. This
works with native and Nx executors, including automatically migrated Nx project
files. The source configuration and workspace cache retain their original values;
the selected options are computed for each invocation. Only one configuration
can be selected per invocation. Other executor CLI flags are not forwarded.

## Workspace cache

Isox stores discovered projects in `.isox/workspace.json`. After adding, changing,
renaming, or removing project files, run `isox reset`. The cache stores project
configuration, not build outputs or task results. `affected`, `plan`, and
`run-many` always rescan project files and refresh the cache.

See [workspace configuration](configuration.md) for discovery details and
[Nx migration](nx-migration.md) for temporary adapter support.

## Current scope

Affected selection follows inferred and explicitly declared dependencies. Parallel execution uses
separate child CLI processes, and the GitHub actions distribute exact weighted
project lists. See [affected projects and CI](affected-and-ci.md).
Declaring `dependencies` does not schedule prerequisite builds; prepare required
outputs before running workers. Task-result caching, dependency task scheduling,
and isolation remain on the [roadmap](../ROADMAP.md).
