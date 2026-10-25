---
title: "Getting started"
description: "Install Isox, initialize your workspace, and run your first project command."
sidebarTitle: "Getting started"
icon: "rocket"
---

## Requirements

Node.js 24+. Use your existing npm, pnpm, or Yarn workspace.
Use Node.js 24 or 26+ if you also install the ESLint or Vitest plugins.
Isox runs project commands without a background daemon. It also supports
[affected selection and CI distribution](/docs/affected-and-ci).

## Install

Install the CLI in your workspace. Its core dependency is installed automatically:

```sh
npm install --save-dev isox
npx isox init
```

With pnpm, use `pnpm add -Dw isox` at the workspace root, then
`pnpm exec isox init`. With Yarn, use `yarn add --dev isox`, then `yarn isox init`
(Yarn Classic workspaces may need `-W` when installing at the root).

`init` creates `isox.json` with the installed CLI's version and never overwrites
an existing file. The nearest ancestor containing this file is the workspace
root. Add `.isox/` to `.gitignore`.

## Run your first command

Create a directory named `apps/hello` with this `project.json`:

```json apps/hello/project.json
{
  "name": "hello",
  "targets": {
    "greet": {
      "executor": "core:run-command",
      "options": {
        "command": "node -e \"console.log('Hello from Isox')\""
      }
    }
  }
}
```

Run it from your workspace root:

```sh
npx isox greet hello
```

The command prints `Hello from Isox`. `npx isox run hello:greet` runs the same
command. This example uses only Node.js and the built-in shell executor.
For subsequent examples, `isox` refers to the CLI on your PATH; with a local
installation, prefix commands with `npx`, `pnpm exec`, or `yarn`.

## Local and global installations

Prefer a local installation so collaborators and CI use the version recorded in
your workspace's lockfile. The examples use `npx isox`; `pnpm exec isox` and
`yarn isox` run the locally installed CLI too.

For a global CLI installation:

```sh
npm install --global isox
```

The built-in `@isox-sh/core:run-command` executor is available with both local and
global CLI installations, including pnpm's isolated dependency layout. A directly
installed workspace copy of core takes precedence. Other executor packages still
need to be installed in the workspace.

## Define a project

To scaffold a TypeScript project, install `@isox-sh/js` in your workspace and run:

```sh
npm install --save-dev @isox-sh/js
npx isox init @isox-sh/js packages/test --importPath=@org/test
npx isox build test
```

This requires an existing Isox workspace. It creates `project.json`,
`tsconfig.json` for editors, `tsconfig.build.json` for compilation, and `src/index.ts`
in a new directory, plus `tsconfig.base.json`
at the workspace root if missing. The optional `--importPath` adds an alias to
the base config's `compilerOptions.paths`. Existing settings and comments are
preserved. Relative paths resolve from the current directory; absolute paths
must also be inside the workspace. Existing destinations, duplicate project
names, and conflicting aliases are rejected.

For an existing npm workspace named `@example/web` with a `build` script, create
`apps/web/project.json`:

```json
{
  "name": "web",
  "targets": {
    "build": {
      "executor": "@isox-sh/core:run-command",
      "options": {
        "command": "npm run build --workspace @example/web"
      }
    }
  }
}
```

Replace the shell command with your own tool or package-manager script, then run:

```sh
npx isox build web
```

If you have already run another project command before manually adding this
project, run `npx isox reset` first so discovery includes it.

The project's root is the directory containing `project.json`. Its name defaults
to that directory's name when omitted. `dependencies` and `tags` are optional.
Additional project and command properties are preserved for your own tools.
For editor schema completion or direct imports of core APIs/types, optionally
install `@isox-sh/core` as a direct dependency and reference its
`schemas/project.schema.json`. This is not required to run built-in commands.

Commands run from the workspace root by default. Set `options.cwd` on
`run-command` to choose another directory. Shell commands inherit environment
variables and terminal streams; a nonzero exit fails the command. Avoid scripts
that call the same Isox command recursively.

## Add tooling to a project

Install the executor plugin, then add its target to the project's `targets`.
Some plugins also provide an `add` generator. For example, the release plugin can
configure an existing project named `web`:

```sh
npm install --save-dev @isox-sh/semver
npx isox add @isox-sh/semver web
npx isox version web --dry-run
```

`add` looks up an existing project by name; `init <package> <path>` creates a new
project directory. Neither command installs the plugin package. For versioning,
the project must have a `package.json` with a valid name and version and live in
a Git repository. See [releases](/docs/semver) before running a real release.

Next, see the [CLI reference](/docs/cli), [workspace configuration](/docs/configuration),
and [TypeScript executor](/docs/typescript).
