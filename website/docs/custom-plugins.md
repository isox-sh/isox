---
title: "Build Isox plugins"
description: "Start with a working executor, then add generators, migrations, and tests."
sidebarTitle: "Overview"
icon: "puzzle-piece"
---

A plugin is an npm package that adds executors, generators, or migrations to
Isox. Include only the capabilities you need.

<Card title="Create your first plugin" icon="hammer" href="/docs/plugin-quickstart">
  Build a working executor, install it locally, and run it from an Isox target.
</Card>

## Choose a capability

| I want to… | Build | Example |
| --- | --- | --- |
| Run a tool from a project target | [An executor](/docs/custom-executors) | Build, lint, or deploy |
| Create a project or configure an existing one | [A generator](/docs/plugin-generators) | Scaffold a library or add a test target |
| Update configuration when a plugin is upgraded | [A migration](/docs/plugin-migrations) | Rename an option in existing projects |

## Build, test, and share

1. **Get a working example:** follow [your first plugin](/docs/plugin-quickstart).
2. **Organize the package:** declare registries and ship compiled files with [layout and packaging](/docs/plugin-packaging).
3. **Test what users install:** run the built package through the CLI with [plugin testing](/docs/plugin-testing).

Use [plugin helpers](/docs/plugin-helpers) for logging and configuration edits,
and the [Core API](/docs/core-api) for workspace discovery and execution.

Looking to use an existing plugin? The **Guides** tab covers
[TypeScript](/docs/typescript), [ESLint](/docs/eslint), [Vitest](/docs/vitest), and
[releases](/docs/semver).
