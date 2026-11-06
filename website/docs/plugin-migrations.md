---
title: "Writing plugin migrations"
description: "Publish versioned configuration migrations and package their implementations."
sidebarTitle: "Migrations"
icon: "arrows-rotate"
---

## Publish migration scripts

Ship versioned migration scripts to update workspace configuration when your plugin
changes. Keep each script safe to rerun and preserve unrelated user settings.

Declare a registry in the package's `package.json`:

```json
{ "migrations": "./migrations.json" }
```

The registry maps stable migration names to the release that introduced them:

```json
{
  "migrations": {
    "rename-build-option": {
      "version": "1.2.0",
      "description": "Rename the legacy build option",
      "implementation": "./dist/migrations/rename-build-option.js"
    }
  }
}
```

This example uses the plugin-local `dist` layout from
[layout and packaging](/docs/plugin-packaging). Implementation paths
resolve relative to the registry. Export a function, or a
default function, accepting `MigrationContext` from `@isox-sh/core`:

```ts
import type { MigrationContext } from '@isox-sh/core'

export default async function migrate({ workspaceRoot, logger }: MigrationContext) {
  // Read and update configuration under workspaceRoot; tolerate already updated files.
  logger.info(`Migrating ${workspaceRoot}`)
}
```

Include the registry and compiled implementations in the published package.
The `js:tsc` executor copies the `migrations` registry and rewrites its
implementation paths when `generatePackageJson` is enabled. Keep older definitions
so users can skip releases. The runner resolves scripts from installed package
registries and checks their recorded versions before executing them. Isox migrations
use this context API; Nx Tree-based migration implementations are not interchangeable.

See [Updating Isox and running migrations](/docs/migrations) for the consumer
workflow. Automatic planning currently selects root `@isox-sh/*` dependencies;
other installed plugins can run migrations through a manually prepared plan.
