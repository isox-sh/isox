---
title: "Rspack"
description: "Build bundles and run a development server with native Isox targets."
---

With `@isox-sh/rspack` installed in the workspace, initialize a new project, then build or serve it.

```sh
isox init @isox-sh/rspack apps/web
pnpm install
isox build web
isox serve web --port=4200
```

The initializer creates `apps/web/src/index.js`, `apps/web/rspack.config.mjs`,
and a `project.json` named `web` with the following targets. Choose a new
directory for the project.

```json
{
  "build": {
    "executor": "rspack:build",
    "cache": true,
    "outputs": ["{projectRoot}/dist"]
  },
  "serve": { "executor": "rspack:serve" }
}
```

Both executors run in the project's directory. For a JavaScript project using
`src/index.js`, a default build produces `dist/main.js`. Put entry points,
loaders, plugins, output paths, and dev server settings in the project's
`rspack.config.mjs`. The initializer declares `@isox-sh/rspack`, `@rspack/core`,
`@rspack/cli`, and `@rspack/dev-server` in the workspace root’s dev dependencies.

### Import workspace libraries

The generated Rspack config reads the workspace root's `tsconfig.base.json`
when it exists. To create a library without linting, install the JS plugin at
the pnpm workspace root and initialize the library with its import alias.

```sh
pnpm add -Dw @isox-sh/js
pnpm exec isox init @isox-sh/js libs/shared --import-path=@demo/shared --linter=none
```

Import the library from the app using `@demo/shared`. Both build and serve use these path mappings.
The built-in SWC loader transpiles the library's TypeScript source, including
relative `.js` imports that refer to `.ts` files. The library can keep its own
`tsconfig.build.json` for standalone compilation and type checking.

### Executor options

| Option | Targets | Behavior |
| --- | --- | --- |
| `configFile` | build, serve | Select a config by absolute path or relative to the workspace root. Defaults to Rspack's project-local discovery. |
| `mode` | build, serve | Override the Rspack mode with `development`, `production`, or `none`. |
| `port` | serve | Override the server port. Use `0` to request an available port. |

For example, `isox build web --config-file=configs/web.mjs` runs a build using
a shared config. The package includes the Rspack CLI and development server.
The fully scoped executor names are `@isox-sh/rspack:build` and `@isox-sh/rspack:serve`.

The generated build target caches the project’s `dist` directory. If you change
Rspack’s `output.path`, update the target’s `outputs` to match. Include any
shared configuration or other external build inputs in the target's `inputs`.
See [task caching](/docs/task-caching).
