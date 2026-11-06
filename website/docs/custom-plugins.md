---
title: "Custom plugins"
description: "Build and publish native Isox executors, generators, and migrations."
sidebarTitle: "Overview"
icon: "puzzle-piece"
---

A native Isox plugin is a package that provides executors, generators, or migration
scripts. Publish only the features your plugin needs; each registry points to
compiled implementations in the package.

| Feature | Purpose | Package metadata |
| --- | --- | --- |
| [Executors](/docs/custom-executors) | Run project targets, such as builds or checks. | `"executors": "./executors.json"` |
| [Generators](/docs/plugin-generators) | Initialize projects or add plugin configuration to existing projects. | `"generators": "./generators.json"` |
| [Migrations](/docs/plugin-migrations) | Update workspace configuration for a new plugin release. | `"migrations": "./migrations.json"` |

## Build a plugin

1. Set up the [plugin layout and packaging](/docs/plugin-packaging), including compiled files and any schemas.
2. Implement the executors, generators, or migrations your plugin provides.
3. Use [plugin testing](/docs/plugin-testing) to exercise built packages through the CLI in a temporary workspace.

The [Core API](/docs/core-api) provides plugin types, JSON helpers, logging,
workspace discovery, and process execution.

For upgrading a workspace with published migration scripts, see
[Updating Isox and running migrations](/docs/migrations).
