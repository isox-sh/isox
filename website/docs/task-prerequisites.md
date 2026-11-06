---
title: "Task prerequisites"
description: "Run dependency builds and other prerequisites before a target."
icon: "diagram-project"
---

## Task prerequisites

Set `dependsOn` on a target in `project.json` or in `isox.json` target defaults.
Prerequisites run before the requested task, including before a task cache lookup.

```json
{
  "targetDefaults": {
    "build": { "dependsOn": ["^build"] },
    "test": { "dependsOn": ["build"] }
  }
}
```

Each `dependsOn` entry identifies a target to run first:

- `"build"` runs this project's build first.
- `"^build"` runs build on dependency projects. Dependencies combine declared project names, source imports, and workspace package references.
- `"other:build"` runs a target on a named project.
- Target wildcards such as `"build-*"` and `"^build-*"` expand matching targets.
- `{ "target": "build", "dependencies": true }` is the expanded form of `"^build"`.
- `{ "target": "build", "projects": ["lib-a", "lib-b"] }` selects projects explicitly. `projects` also accepts a single string or glob patterns.
- `{ "target": "prepare", "params": "forward", "options": "forward" }` forwards CLI overrides and configured options independently. Both default to `"ignore"`; forwarded CLI values take precedence.

### Same-project and dependency builds

`"build"` refers to the current project. `"^build"` refers to the projects it
depends on; it does not run the current project's build as a prerequisite of itself.

For example, suppose `app` depends on `shared`. With the `targetDefaults` above,
`isox test app` runs these tasks in order:

```text
shared:build → app:build → app:test
```

The test target's `"build"` entry adds `app:build`. That build target's `"^build"`
entry adds `shared:build`. Each added task expands its own prerequisites, so a
longer dependency chain is built in the same way.

### Expanded entries and forwarded options

Use an object entry when you need to select projects or forward values:

```json
{
  "dependsOn": [
    { "target": "build", "dependencies": true },
    { "target": "prepare", "params": "forward", "options": "forward" },
    { "target": "generate", "projects": ["schema"] }
  ]
}
```

| Field | Behavior |
| --- | --- |
| `target` | Required target name or wildcard pattern. |
| `dependencies` | Set to `true` to select dependency projects. Defaults to `false`. |
| `projects` | Project name, glob pattern, or array of names and patterns. Cannot be combined with `dependencies`. |
| `params` | `"forward"` passes CLI option overrides to the prerequisite; `"ignore"` (default) leaves them out. |
| `options` | `"forward"` passes the caller's configured options, including its selected configuration; `"ignore"` (default) leaves them out. |

Without `projects` or `dependencies: true`, an unqualified target refers to the
same project. Forwarded values override the prerequisite's own options. When both
`options` and `params` are forwarded, CLI overrides win conflicts. Objects and
arrays are replaced rather than deeply merged.

For example, `isox test app --mode=fast` passes `mode: "fast"` to a prerequisite
with `params: "forward"`. Without that setting, the prerequisite receives its own
configured `mode` value. These are executor options; forwarding them does not
automatically append flags to a shell command.

### Scheduling and configuration

Local `dependsOn` replaces inherited dependencies; use `[]` to clear them.
A prerequisite uses the caller's configuration when it defines that configuration,
otherwise its own default. Missing targets on existing projects are skipped, but
an unknown project named in `project:target` fails. `^target`
continues through projects lacking that target to find upstream matches.
Shared prerequisites run once per task graph, identified by project, target, and
configuration. Each multi-target stage has its own graph; all stage graphs are
validated before the first stage runs. Cycles fail before any task executes, and failed prerequisites prevent dependent tasks from starting.

Direct commands and the core `runExecutor` API expand prerequisites. `run-many`
and `affected` expand them after project selection, including prerequisites outside
the selected project list, and honor `--parallel` with isolated worker processes.
Dependencies must finish successfully before dependent tasks start. A prerequisite
that watches for changes or otherwise runs indefinitely prevents its dependents
from starting; use tasks that exit for prerequisites.

[Back to workspace configuration](/docs/configuration).
