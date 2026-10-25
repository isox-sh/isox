---
title: "Plugin end-to-end testing"
sidebarTitle: "Plugin testing"
description: "Test Isox plugins in temporary workspaces with locally built packages and the public CLI."
icon: "vial"
---

Reusable end-to-end workspaces for testing Isox plugins. Requires Node.js 24 or
26+. Install this package as a development dependency using your package manager.
The Isox CLI and core are included as dependencies.

```sh
npm install --save-dev @isox-sh/e2e
```

## Usage

Build your plugin and install its dependencies first. The owning repository must
contain `isox.json`. The plugin directory must expose compiled entry points from
its `package.json`; use `dist/plugin` if that is your standalone output package.
The example below assumes `packages/plugin` already resolves to a built package.
With Vitest installed in the test workspace:

```js
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'

import { createWorkspace } from '@isox-sh/e2e'
import { test } from 'vitest'

test('initializes and builds my plugin', async t => {
  const workspace = await createWorkspace({
    startDirectory: import.meta.dirname,
    plugins: { '@example/plugin': 'packages/plugin' },
  })
  t.onTestFinished(workspace.cleanup)

  await workspace.runIsox(['init'])
  await workspace.runIsox(['init', '@example/plugin', 'apps/demo'])
  await workspace.runIsox(['build', 'demo'])

  const output = await readFile(join(workspace.root, 'apps/demo/dist/index.js'), 'utf8')
  assert.ok(output.length > 0)
})
```

Use the initializer and output path implemented by your plugin. For executor-only
plugins, use core's `writeJson` to define the fixture's `project.json` before
calling `runIsox`. The helper does not depend on Vitest: with Node's test runner,
register `t.after(workspace.cleanup)`; with other runners, use their teardown hook
or `try/finally`.

## Options and result

`createWorkspace(options?)` discovers the nearest `isox.json` using core's
`findWorkspaceRoot`, then creates a unique `<workspace>/tmp/isox-e2e-*` directory.
It writes a private `package.json`, but leaves workspace initialization to the
test so that `isox init` is exercised too.

| Option | Behavior |
| --- | --- |
| `startDirectory` | Directory from which to detect the owning workspace; defaults to `process.cwd()` |
| `plugins` | Package names mapped to package directories, relative to the owning workspace or absolute |
| `cliDirectory` | Optional alternate CLI package directory, relative to the owning workspace or absolute |
| `timeout` | Maximum milliseconds per command; defaults to `30000` |
| `logger` | Optional core logger for fixture setup |

Each directory must contain a `package.json` with the matching name. `isox` and
the CLI's `@isox-sh/core` are supplied automatically and are reserved names in
`plugins`. `cliDirectory` lets you select a local CLI build instead of the bundled
dependency. Package discovery does not assume a monorepo directory layout.

The result exposes `root`, the CLI's `version`, `runIsox(args, cwd?)`,
`runNode(args, cwd?)`, and `cleanup()`. Both command helpers return `{ stdout,
stderr }`, run without a shell, and reject on failure with command details,
captured output, and the original error as `cause`. The working directory defaults
to the fixture root. `cleanup()` removes only that fixture and can be called more
than once. Setup errors clean up automatically.

## Package managers

The helper creates filesystem links (directory junctions on Windows), reusing
each package's already-installed dependencies. It does not invoke a package
manager, install packages, use a global link registry, or access the network.
This works with npm, pnpm, Yarn using `nodeLinker: node-modules`, and Bun's
`node_modules` installations. Yarn Plug'n'Play-only layouts are not supported by
this fixture mode; use Yarn's `node-modules` linker for these tests.

`file:` directory dependencies require a package-manager install and do not have
uniform behavior: [Yarn copies directory packages](https://yarnpkg.com/protocol/file),
while [pnpm installs their dependencies](https://pnpm.io/cli/link). Direct links
keep local builds and dependency resolution consistent without a fixture install.
These tests exercise built local packages, not packed or published artifacts.

## Repository development

Run `pnpm bootstrap`, then `pnpm isox test e2e-plugin` for this package's tests.
The repository's init/build scenarios use this public API and run with
`pnpm isox test e2e`.
