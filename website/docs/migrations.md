---
title: "Updating Isox and running migrations"
description: "Plan Isox package upgrades, review migration plans, and run or retry migration scripts."
sidebarTitle: "Updating Isox"
icon: "arrows-rotate"
---

Upgrade Isox by planning the update, reviewing the changes, installing packages,
and running the selected migration scripts.

## Plan and run an update

```sh
pnpm exec isox migrate latest # or an exact version, such as 1.2.0
# Review package.json and migrations.json before installing.
pnpm install
pnpm exec isox migrate --run-migrations
```

These examples use pnpm. With npm or Yarn, invoke the local CLI with `npx isox`
or `yarn isox`, and use your package manager to install dependencies.

Planning updates the root `package.json` entries for `@isox-sh/*` in
`dependencies`, `devDependencies`, and `optionalDependencies`. It preserves `^`
and `~` prefixes, skips `workspace:`, `file:`, and `link:` dependencies, and
resolves `latest` once so the packages stay on the same release. Dependencies
must already be installed: their actual versions determine which migrations apply.
Downgrades and unsupported dependency specifiers are rejected.

The command writes an editable `migrations.json` containing scripts newer than
the installed version and no newer than the target version. Review both files
before installing. Planning uses npm and its registry configuration to read
published metadata; packages declaring migrations are installed into a temporary
directory with lifecycle scripts disabled, then removed. Your workspace lockfile
is updated by your own install command.

## Review and rerun migration plans

An existing plan is never overwritten. After a successful upgrade, remove it or
keep it for teammates to rerun, then remove it before planning the next upgrade.
Even upgrades without scripts create an empty plan. The runner executes entries
in file order, stops on the first failure, and leaves the plan intact. Fix a
failure and rerun, or remove already completed entries from the plan. Migrations
should be idempotent. A failed script can leave partial changes; review your diff.

```sh
pnpm exec isox migrate --run-migrations=plans/upgrade.json
pnpm exec isox migrate --run-migrations --if-exists
```

Plan paths are relative to the workspace root, including when called from a
nested directory. `--if-exists` skips a missing plan; it does not ignore invalid
plans or failed scripts. This upgrades Isox packages; conversion from Nx is
covered in the [Nx migration guide](/docs/nx-migration).

To add migrations to a plugin, see [publishing migration scripts](/docs/plugin-migrations#publish-migration-scripts).
