# Getting started

[Documentation index](README.md)

## Requirements

Node.js 24+. Use your existing npm, pnpm, or Yarn workspace.
Isox runs one project command at a time and does not require a background daemon.

## Install

Install the CLI in your workspace. Its core dependency is installed automatically:

```sh
npm install --save-dev isox
npx isox init
```

With pnpm, use `pnpm add -Dw isox` at the workspace root, then
`pnpm exec isox init`.

`init` creates `isox.json` with the installed CLI's version and never overwrites
an existing file. The nearest ancestor containing this file is the workspace
root. Add `.isox/` to `.gitignore`.

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
isox init @isox-sh/js packages/test --importPath=@org/test
isox build test
```

This requires an existing Isox workspace. It creates `project.json`,
`tsconfig.json`, and `src/index.ts` in a new directory, plus `tsconfig.base.json`
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
  "dependencies": [],
  "executors": {
    "build": {
      "executor": "@isox-sh/core:run-command",
      "options": {
        "command": "npm run build --workspace @example/web"
      }
    }
  },
  "tags": []
}
```

Replace the shell command with your own tool or package-manager script, then run:

```sh
npx isox build web
```

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

Next, see the [CLI reference](cli.md), [workspace configuration](configuration.md),
and [TypeScript executor](typescript.md).
