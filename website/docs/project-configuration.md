---
title: "Project configuration"
description: "Define projects, targets, and cache inputs."
icon: "sliders"
---

Use `project.json` to name a project and declare its runnable targets. Workspace-wide defaults live in [isox.json](/docs/configuration).

## Project definitions

Each project has a `project.json`. Its location determines the project root.
The entries under `targets` are the commands you can run with Isox:

```json
{
  "$schema": "../../node_modules/@isox-sh/core/schemas/project.schema.json",
  "name": "web",
  "plan": { "weight": 3 },
  "targets": {
    "build": {
      "executor": "js:tsc",
      "options": {
        "tsConfig": "apps/web/tsconfig.build.json"
      }
    }
  },
  "tags": ["type=frontend"]
}
```

This example belongs in `apps/web/project.json` and requires `@isox-sh/js`.
Install `@isox-sh/core` directly to use the shown editor schema path, or omit
`$schema`. Isox validates project definitions against its bundled schema either way.

### project.json reference

All top-level project fields are optional. The directory containing `project.json`
is the project root; a custom `root` property does not override it.

| Field | Type | Default and behavior |
| --- | --- | --- |
| `$schema` | string | Optional editor schema URL or path. The shown example uses the bundled project schema. |
| `name` | string | Containing directory name. Must be unique in the workspace, non-empty, and contain no whitespace or colons. |
| `targets` | object | No targets. Keys are non-empty target names without whitespace or colons; each value requires an `executor`. See [target reference](/docs/project-configuration#target-reference). |
| `dependencies` | unique string array | No additional dependencies. Project names are merged with inferred dependencies; this is not a list of npm packages. Names cannot contain whitespace or colons. |
| `namedInputs` | object | Workspace input sets are inherited. Each local key replaces the entire set with that name. See [input reference](/docs/project-configuration#input-reference). |
| `tags` | unique string array | `[]`. Non-empty labels used by selection, such as `type=frontend`. `ci=off` excludes ordinary automatic selection. |
| `plan` | object | Optional project selection and distribution settings. |
| `plan.enabled` | boolean | `true`. `false` excludes automatic selection; direct commands, exact project lists, and prerequisite execution can still run the project. |
| `plan.weight` | positive number | `1`. Relative cost when balancing CI shards; fractional values are allowed. |

Core exports `ProjectDefinition` and `ExecutorConfiguration` TypeScript types.

Projects using the former `executors` field should rename it to `targets`.
Plugin `executors.json` registries and `nx.executors` settings keep their names.

Project and command objects allow additional properties for use by custom
executors and other tools. Isox preserves them in the workspace cache and executor
context: read them through `context.project` and `context.command`. The exported
TypeScript interfaces expose additional fields as `unknown`, so consumers can
narrow them to their own types. Defined Isox fields are still validated.

See [named configurations](/docs/cli#named-configurations) for option overrides and
[Nx project conversion](/docs/nx-migration#project-conversion) for existing Nx files.

## Target reference

A target lives at `project.json.targets.<name>`. The same optional fields can be
supplied by `isox.json.targetDefaults.<target-or-executor>`. Defaults only apply
to targets already declared by projects; every project target needs its own
`executor`. The defaults below apply after workspace and project settings merge.

| Field | Type | Default and behavior |
| --- | --- | --- |
| `executor` | string | Required on project targets. `package:executor`, such as `js:tsc` or `core:run-command`. Both parts must be non-empty and contain no whitespace or colons. |
| `options` | object | `{}`. Executor-specific base options. See the executor's reference for supported keys and defaults. |
| `configurations` | object of option objects | `{}`. Each key names one set of executor-option overrides. Names cannot be empty or contain whitespace, colons, or commas. |
| `defaultConfiguration` | string | No configuration selected automatically. Must name an existing configuration; an explicit CLI selection takes precedence. |
| `dependsOn` | array of strings or dependency objects | `[]`. Tasks that must succeed first. Local arrays replace inherited ones; `[]` clears them. See [task prerequisites](/docs/task-prerequisites#task-prerequisites) for every string form and object field. |
| `cache` | boolean | `false`. Opts deterministic native tasks into result caching. See [task caching](/docs/task-caching) for exclusions and output ownership. |
| `inputs` | input-entry array | The `default` named set, falling back to all project files. A local array replaces inherited inputs. `[]` omits local file/environment inputs; automatic workspace metadata and dependency inputs still participate. |
| `outputs` | unique string array | No artifact directories; cache successful results and logs only. Entries are concrete workspace-relative directories, with path tokens supported. No globs or individual files. `[]` clears inherited outputs. |

`configurations.<name>` contains executor options directly. It is not another
target definition: placing `cache`, `dependsOn`, or `inputs` there passes those
keys to the executor instead of changing task scheduling or caching. Nested option
objects and arrays are replaced when overrides merge. See [target defaults](/docs/configuration#target-defaults)
for the full precedence order.

For example, this target uses a prerequisite, caching, and two shell-command
configurations:

```json
{
  "targets": {
    "prepare": {
      "executor": "core:run-command",
      "options": { "command": "node tools/prepare.mjs" }
    },
    "build": {
      "executor": "core:run-command",
      "dependsOn": ["prepare"],
      "cache": true,
      "inputs": ["production", "^production", { "env": "BUILD_MODE" }],
      "outputs": ["{workspaceRoot}/dist/{projectName}"],
      "options": { "command": "node tools/build.mjs", "cwd": "." },
      "configurations": {
        "development": { "command": "node tools/build.mjs --mode=development" },
        "production": { "command": "node tools/build.mjs --mode=production" }
      },
      "defaultConfiguration": "production"
    }
  }
}
```

This example uses the workspace's `production` input set from the
[workspace configuration example](/docs/configuration). The build
script must write to the declared output directory and every file it reads must
be included in the inputs. Add script files outside project roots to a shared set.

Executor option references: [shell commands](/docs/shell-commands),
[TypeScript](/docs/typescript), [ESLint](/docs/eslint), [Vitest](/docs/vitest),
and [release automation](/docs/semver).

## Input reference

`namedInputs` belongs at the top level of `isox.json` or `project.json`. Each value
is an array using the same entries as target `inputs`. Set names start with a
letter or underscore, followed by letters, digits, underscores, or hyphens.
An empty array defines an empty set.

| Entry | Meaning |
| --- | --- |
| `"{projectRoot}/src/**/*"` | File pattern evaluated for the owning project. Plain paths and globs are workspace-relative. |
| `"{workspaceRoot}/tools/config.json"` | A shared workspace file. `{projectName}` is also supported in paths. |
| `"!{projectRoot}/**/*.test.ts"` | Exclude matching files from that project's selected inputs. Exclusions win over inclusions. |
| `"production"` | Expand the named set for the current project, using its overrides. Strings that do not name a set remain file patterns. |
| `"^production"` | Expand the named set for all direct and transitive dependency projects, using each dependency's overrides. |
| `"^{projectRoot}/src/**/*.ts"` | Select files directly from dependency projects. |
| `{ "env": "BUILD_MODE" }` | Include the environment variable's value. Names start with a letter or underscore and contain only letters, digits, or underscores. Unset and empty values differ. |

Sets can reference other sets. Cycles and missing dependency set names fail.
A local set replaces the workspace set with the same name; other workspace sets
remain available. `default` falls back to `["{projectRoot}/**/*"]` when undefined.
`sharedGlobals` has no special behavior: include it from another set to use it.

Dependency references prefixed with `^` replace automatic dependency source
selection for that task. They do not remove dependency configuration, manifests,
or declared build artifacts from the cache key. Inputs select cache content and affected tasks;
[`dependsOn`](/docs/task-prerequisites#task-prerequisites) schedules tasks. See
[named inputs](/docs/cache-inputs#named-inputs) for examples and
[cache keys](/docs/cache-inputs#inputs-and-the-key) for automatic inputs and path restrictions.

The same input resolution controls `affected` and each target in `plan`, including
shared paths outside the project root. Targets without explicit `inputs` or a
customized `default` set retain conservative owner/dependent selection. Automatic
project metadata and dependency artifacts still participate; Git selection cannot
detect environment or runtime changes. `affected.ignoreFiles` applies first,
then global-file rules, then target inputs and prerequisite inputs. See
[target selection](/docs/affected-and-ci#target-inputs-and-prerequisites).

[Back to workspace configuration](/docs/configuration).
