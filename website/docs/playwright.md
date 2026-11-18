---
title: "Playwright"
description: "Run Playwright Test and distribute a project's tests across CI workers."
---

With `@isox-sh/playwright` available in the workspace, run the add generator to
declare the plugin and `@playwright/test` in the workspace root’s dev dependencies. Install the browsers
your suite uses on each worker, for example with `pnpm exec playwright install chromium`.

```sh
isox add @isox-sh/playwright web
pnpm install
isox e2e web
isox plan --all --target=e2e --max-jobs=3
```

The generator adds an `e2e` target with executor `playwright:test`. Run it
directly to execute the whole suite from the project directory. Playwright
discovers its configuration there. To select a different config, pass
`--config-file=apps/web/playwright.ci.config.ts` or set `options.configFile`
on the target. Explicit config paths resolve from the workspace root.

## Choose a CI shard count

Set `planner.shards` on the project's `e2e` target. You can also set it under
`targetDefaults` in `isox.json` for targets that omit a local shard count. For exactly three CI jobs, use the following target.

```json
{
  "e2e": {
    "executor": "playwright:test",
    "planner": { "shards": 3 }
  }
}
```

- **A number from 1 to 256** reserves that many jobs. With `3`, the rows carry
  `1/3`, `2/3`, and `3/3`, even for a small suite. You can omit `--max-jobs`.
  If you set it explicitly, it must accommodate all reservations plus at least
  one job for any remaining projects.
- **`"auto"`** is the default. With spare capacity from `--max-jobs`, the planner
  runs Playwright in `--list` mode with the target's config and reporters. It checks shard
  assignments and schedules those containing tests that are not statically
  skipped. A suite that cannot be split gets one ordinary run. An empty suite
  also gets one ordinary run so Playwright can report the missing tests.
  Auto keeps a single job when the Playwright config selects a shard or uses
  global setup, or when focused tests make list-mode assignments unreliable.

Pass the complete matrix row to the Isox run-many action. To reproduce one job
locally, run `isox e2e web --shard=2/3`. An explicit `shard` selects that
single slice and takes precedence over the planned count. Running `isox e2e web`
executes the full suite when no single slice is selected.

Playwright chooses which tests belong to each shard. Set `fullyParallel: true`
in the Playwright config to distribute individual tests from the same file.
Browser selection, reporters, and retries also belong in the Playwright config.
[Playwright sharding guide](https://playwright.dev/docs/test-sharding)
