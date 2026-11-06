---
title: "Project discovery"
description: "Control project boundaries, dependency inference, and CI selection."
icon: "magnifying-glass"
---

Isox finds projects inside the workspace, then derives dependencies when a command needs them. Use ignore rules to keep fixtures and generated files out of that graph.

## Discovery boundaries

Discovery honors the workspace's `.gitignore` and nested `.gitignore` files,
including Git-style negation and directory rules. Patterns are case-sensitive on
all platforms. Git does not need to be
initialized. These rules apply even to tracked files; user-wide Git excludes and
`.git/info/exclude` are not consulted.

Use a root `.isoxignore` for additional exclusions that should remain in version
control, such as fixture projects or generated sources:

```gitignore
# Exclude fixtures from project discovery and dependency inference
fixtures/
# Exclude generated directories anywhere in the workspace
**/generated/
```

`.isoxignore` uses the same pattern syntax. Negation can undo rules within that
file, but cannot re-include a path excluded by `.gitignore`. As with Git, an ignored
directory is not traversed: re-include its parent directories before its children.
Ignore-file changes affect the next fresh discovery or dependency-analysis request.
Run `isox reset` before a single-project command if the change adds or removes
projects from discovery.

`node_modules`, `.git`, and `.isox` are always excluded. A nested `isox.json`
marks an independent workspace; its entire subtree belongs to that workspace.
Discovery skips symlinked files and directories, including symlinked projects.
The workspace root itself can be reached through a symlink. Add generated output
directories to `.gitignore` or `.isoxignore` so copied `project.json` files cannot
become projects. TypeScript dependency inference also excludes configured compiler
outputs.

These files control discovery. Use `affected.ignoreFiles` to omit changed file
paths from affected selection, including paths otherwise owned by a root project.

## Dependency discovery

Dependency analysis runs when affected selection or an executor requests it.
Parsing project definitions alone does not run it. TypeScript configs are optional;
projects without them participate through manifests, imports and explicit dependencies.

The resolver detects project dependencies from TypeScript/JavaScript imports,
re-exports, literal dynamic imports and require calls, including type-only imports
and test files. Package names and subpaths map to their owning projects. Relative
cross-project imports and exact or wildcard TypeScript `paths` aliases also count;
extended configs and project-specific overrides are respected. Aliases can point
to source files or declared compiler output directories, even before a build.
Output ownership uses the build target's `options.tsConfig`, including its default
configuration and inherited `outDir`, `declarationDir`, and `rootDir`. When that
option is absent or its file does not exist, the resolver uses the project's
`tsconfig.json`, then the workspace's `tsconfig.base.json` or `tsconfig.json`.
Source aliases use the project or shared editor config. Existing malformed
configs produce an error; no config is required for a plain JavaScript project.

Local package references in `dependencies`, `devDependencies`, `optionalDependencies`,
and `peerDependencies` are also detected. Package aliases and relative workspace
references are supported. Duplicate workspace package names fail dependency analysis.

Use `project.json`'s optional `dependencies` for additional project names that
cannot be inferred, such as dynamically selected plugins or generated inputs.
These are merged with detected dependencies in memory; the definitions cache and
source project files stay unchanged. Comments, ordinary strings, Node builtins, self-imports,
dependency folders and recognized output directories are excluded. Generated files
outside the ignored paths and configured output directories are still scanned.
Merely listing a command's executor does not add an edge. Affected planning
rejects unknown dependencies and reports dependency cycles. See
[cycle troubleshooting](/docs/troubleshooting#project-dependency-cycle) when a
root project or test imports introduce unexpected relationships.

## CI selection

Set `plan.enabled` to `false` to exclude a project from `affected`, `plan`, and
ordinary `run-many` selection. It defaults to `true`. Direct commands and exact
`run-many --projects-json` lists can still run it, and changes still affect its
dependents. The existing `ci=off` tag also excludes projects, even when
`plan.enabled` is `true`.

`plan.weight` is a positive number that estimates a project's relative CI cost.
It defaults to `1`; increasing it gives the project more weight when balancing
shards. Fractional weights are supported. See [affected and CI](/docs/affected-and-ci)
for tag filters, distribution, and workspace-relative `affected.globalFiles` and
`affected.ignoreFiles` globs in `isox.json`. Global files select every project;
ignored files are excluded first. Other files outside any project do not affect
selection by default.

[Back to workspace configuration](/docs/configuration).
