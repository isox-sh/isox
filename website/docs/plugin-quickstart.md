---
title: "Create your first plugin"
description: "Build a local executor plugin, install it in a workspace, and run it through Isox."
sidebarTitle: "Your first plugin"
icon: "hammer"
---

Build a plugin with a `greet` executor that prints a message. This example uses
plain CommonJS JavaScript so you can run it without a compilation step. Once it
works, use the [TypeScript executor contract](/docs/custom-executors) to add types.

## 1. Prepare a workspace

Use an existing Isox workspace with Node.js 24 or 26+. If you need a new one:

```sh
mkdir plugin-demo
cd plugin-demo
npm init -y
npm install --save-dev @isox-sh/cli
npx isox init
```

Run the remaining commands from the workspace root.

## 2. Create the plugin package

Create this directory structure:

```text
tools/isox-greeting/
├── package.json
├── executors.json
└── greet.cjs
```

Add `tools/isox-greeting/package.json`:

```json
{
  "name": "@example/isox-greeting",
  "version": "0.0.1",
  "private": true,
  "executors": "./executors.json",
  "files": ["executors.json", "greet.cjs"]
}
```

The `executors` field tells Isox where to find the registry. Add
`tools/isox-greeting/executors.json`:

```json
{
  "executors": {
    "greet": {
      "implementation": "./greet.cjs"
    }
  }
}
```

Implementation paths are relative to the registry file. Add
`tools/isox-greeting/greet.cjs`:

```javascript
module.exports = async function greet(options, context) {
  const message = options.message ?? 'Hello from my plugin!'
  if (typeof message !== 'string') {
    throw new Error('message must be a string')
  }
  context.logger.info(`${context.projectName}: ${message}`)
  return { success: true }
}
```

Return `{ success: false }` or throw an error to fail the target. Isox passes
options to your executor; the executor is responsible for validating them.

## 3. Install and configure it

Install the local package so Isox can resolve it from the workspace root:

```sh
npm install --save-dev ./tools/isox-greeting
mkdir -p apps/demo
```

Create `apps/demo/project.json`:

```json
{
  "name": "demo",
  "targets": {
    "greet": {
      "executor": "@example/isox-greeting:greet",
      "options": {
        "message": "My first Isox plugin works."
      }
    }
  }
}
```

The executor reference combines the **package name** and **registry entry**:
`@example/isox-greeting:greet`.

## 4. Run the executor

```sh
npx isox reset
npx isox greet demo
npx isox greet demo --message="Hello again!"
```

The first run logs `demo: My first Isox plugin works.` The second overrides the
configured message and logs `demo: Hello again!`.

Reset refreshes cached project definitions after adding or editing `project.json`.
If you change the plugin's package metadata, reinstall the local package too.

## Where to go next

- [Use TypeScript and package the build](/docs/plugin-packaging).
- [Run processes, handle cancellation, and cache results](/docs/custom-executors).
- [Add generators](/docs/plugin-generators) to configure projects automatically.
- [Test the packaged plugin](/docs/plugin-testing) in a temporary workspace.

The example is private to your workspace. Before publishing, choose your own
package name, remove `private: true`, and check the package contents with
`npm pack --dry-run`. See [layout and packaging](/docs/plugin-packaging) for
compiled implementations and schemas.
