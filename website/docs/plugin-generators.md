---
title: "Project initializers and add generators"
description: "Create projects and configure existing projects through plugin generators."
sidebarTitle: "Generators"
icon: "wand-magic-sparkles"
---

Generators scaffold new projects or configure existing projects. They are
loaded from the installed plugin package. See [layout and packaging](/docs/plugin-packaging)
for implementation locations and published files.

## Project initializers

Declare `"generators": "./generators.json"` in `package.json`, alongside the
`executors` registry. The `generators.json` file maps generator names to their
implementations:

```json
{
  "generators": {
    "init": {
      "implementation": "./dist/generators/init.js",
      "description": "Create a project."
    },
    "add": {
      "implementation": "./dist/generators/add.js",
      "description": "Configure an existing project."
    }
  }
}
```

Paths are relative to `generators.json`. Include only the generators your plugin
provides. Move former top-level `init` and `add` package fields into this registry;
those package fields are no longer used. The CLI currently invokes `init` through
`isox init <package> <path>` and `add` through `isox add <package> <project>`.
Additional names can be recorded for future generators but have no CLI command yet.

The `init` module exports a function (directly or as its
default export) matching core's `ProjectInitializer` type. It receives options
such as `importPath` and a context containing `workspaceRoot`, `projectRoot`,
`projectName`, and `logger`. The CLI resolves the package from the existing
workspace, validates the destination and project name, and refreshes discovery.
The initializer creates the project files and updates any shared configuration.

## Adding plugins to existing projects

Declare an `add` entry in the plugin's `generators.json` to support
`isox add <package> <project>`. Keep its implementation in `src/generators/add.ts`.
The exported function implements core's `ProjectAdder` type:

```typescript
import type { ProjectAdder } from '@isox-sh/core'

const add: ProjectAdder = async (_options, context) => {
  // Read the existing configuration and add the plugin's targets.
  context.logger.info(`Configuring ${context.projectName}`)
}

export default add
```

It receives an empty options object and the same context fields as an initializer:
`workspaceRoot`, `projectRoot`, `projectName`, and `logger`. The CLI looks up
the project by name in fresh workspace discovery and resolves its directory.
Root projects use their project name as well. The command works from any directory
inside the workspace. The CLI resolves the installed package and invalidates
`.isox/workspace.json` after invocation, including on generator failure.
Dependency-analysis entries in `.isox/discovery.json` remain intact and are
validated when next requested.

Generators own their edits and should preserve existing configuration, handle
repeat calls, and reject conflicting targets. The release plugin supplies an
example: `isox add @isox-sh/semver my-package` adds its `version` target.
The TypeScript package builder copies `generators.json` and rewrites all
implementation and optional schema paths into the published output. Generator
schemas are metadata; the CLI does not apply schema validation or defaults.

Test generators in temporary workspaces with the [plugin testing helper](/docs/plugin-testing).
