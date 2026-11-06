---
title: "Cache inputs"
description: "Choose file, environment, and dependency inputs for reusable results."
icon: "file-import"
---

Declare everything a task reads. Start with the default project files, add shared configuration and environment variables, then reuse common sets with named inputs.

## Inputs and the key

`inputs` is an array of file patterns, named input references, and
`{ "env": "NAME" }` declarations. Omit it to use the `default` named input, which
includes all project files unless overridden. An explicit array **replaces** that
default; `[]` declares no project file or environment inputs. Shared workspace
metadata and dependency inputs still participate.

- Paths and globs are relative to the workspace. `{projectRoot}` and
  `{workspaceRoot}` and `{projectName}` are available; use `/` separators on every platform.
- Prefix a pattern with `!` to exclude matches. Exclusions always win. Literal
  directories include their descendants. Hidden files are included.
- `.gitignore` and `.isoxignore` govern discovery, **not task input matching**.
  Ignored files can affect a build, so include or exclude them explicitly here.
- `.git`, `.isox`, `node_modules`, and the current target's output directories
  are excluded from file inputs. Declare other generated directories as exclusions.
- Files outside the project can be included as workspace-relative paths. Paths
  outside the workspace, traversal through `..`, and selected symlinks are rejected.
  Installed executor packages are handled separately.
- File paths, contents and permission bits participate. Timestamps and inode
  identities do not. Missing literals or empty matches are valid: creating a
  matching file changes the key. Empty input directories alone do not affect it.
- Only declared environment variables participate. An unset variable differs
  from an empty value. Declare every variable that affects the task's result.

### Dependency inputs

The SHA-256 key also includes effective options after configuration and CLI
overrides, the selected configuration name, project definitions, and inputs of
transitive project dependencies. Unless dependency inputs are selected with `^`,
Isox uses each dependency's same-named target inputs, or its `default` named input
if those are unspecified. Its target
configuration and applicable named/default options participate too. For cacheable
dependency targets, their actual declared output files also participate, so a
newly rebuilt dependency invalidates consumers even if its sources are unchanged.
Hashing itself does not schedule tasks. Declare
[`dependsOn`](/docs/task-prerequisites#task-prerequisites) to run prerequisite tasks
before the consumer's cache lookup, or prepare those outputs explicitly. Explicitly include any other generated artifacts
the task reads (for example, build outputs used by a `test` target) in `inputs`.

### Automatic inputs

Root `package.json`, `isox.json`, `tsconfig.json`, `tsconfig.base.json`, ignore
files, and supported npm/pnpm/Yarn/Bun lockfiles participate automatically.
Executor package contents (including local compiled implementations), the running
core package's files, installed
package manifests/versions, Node and its component versions, OS release,
architecture, endianness, and the absolute workspace path also participate.
Installed dependency contents are assumed to match their manifests and lockfile;
record patched dependencies in the lockfile. External tools and configuration not
represented by these inputs need explicit file/environment declarations.
Keys conservatively differ across checkout paths and runtime/platform changes.

## Named inputs

Define reusable input sets in `isox.json` and reference them from target `inputs`,
including targets configured through `targetDefaults`:

```json
{
  "namedInputs": {
    "sharedGlobals": ["{workspaceRoot}/tools/config.json", { "env": "NODE_ENV" }],
    "default": ["{projectRoot}/**/*", "sharedGlobals"],
    "production": ["default", "!{projectRoot}/**/*.test.ts"]
  },
  "targetDefaults": {
    "build": {
      "cache": true,
      "inputs": ["production", "^production"]
    }
  }
}
```

`production` reads the current project's set. `^production` reads that set from
every direct and transitive dependency, even projects without a `build` target.
It replaces the automatic dependency source selection for this task. Dependency
configuration, manifests, and declared build artifacts still participate in the
cache key. `^{projectRoot}/src/**/*.ts` selects dependency files directly.

A project's `project.json` can also define `namedInputs`. A project definition
replaces the workspace set with the same name; other workspace sets remain
available. References and path tokens are resolved in each owning project, so
each dependency can supply its own `production` set. Sets may contain other set
names, file patterns, exclusions, and environment declarations. `[]` defines an
empty set. Circular references and unknown dependency set names fail with an error.

Set names start with a letter or underscore and contain letters, digits,
underscores, or hyphens. A string matching a defined set expands that set;
other ordinary strings retain their meaning as workspace-relative file patterns.
Use `{workspaceRoot}/name` to select a path whose name matches a set.
`sharedGlobals` is a conventional name with no automatic behavior: reference it
from `default` or another set to include it.

[Back to task caching](/docs/task-caching).
