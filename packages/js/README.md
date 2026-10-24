# @isox-sh/js

Native TypeScript 7 compiler executor for Isox. Requires Node.js 24+.

## Usage

Install `@isox-sh/js` in your workspace, then define a project command:

```json
{
  "name": "web",
  "commands": {
    "build": {
      "executor": "@isox-sh/js:tsc",
      "options": {
        "tsConfig": "apps/web/tsconfig.json"
      }
    }
  }
}
```

The executor can also be written as `js:tsc`. The first-party
`@isox-sh/js` package is checked before an unscoped package named `js`.

Run `isox build web`. `tsConfig` resolves relative to the workspace root; absolute
paths also work. When omitted, it defaults to `tsconfig.json` in the project root.
Use the tsconfig for compiler options, inputs, declarations, and output paths.
Named Isox configurations can override `tsConfig`.

The executor uses its own TypeScript 7 dependency, installed under the
`@typescript/native` alias, so it can coexist with a different compiler in the
workspace. It runs the compiler without a shell, streams diagnostics to the
terminal, and fails the task when compilation fails. It performs a single
compilation; it does not schedule project dependencies or run watch mode.

In this repository, run `pnpm bootstrap` after installing dependencies to build
core, this executor, and the CLI from a clean checkout. Subsequent builds use
`pnpm isox build js`. Tests live in `tests/` and run with
`pnpm isox test js`.

MIT.
