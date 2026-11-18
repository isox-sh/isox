---
title: "Next.js"
description: "Create, build, and serve Next.js applications with Isox."
---

With `@isox-sh/next` installed at the workspace root, initialize a new
application and start its development server.

```sh
isox init @isox-sh/next apps/web
pnpm install
isox serve web --port=4200
```

The initializer creates a JavaScript App Router project and adds Next.js, React,
and React DOM to the workspace root's dependencies. It adds a `build` target
and registers cache defaults for `next:build` in `isox.json` so builds restore
`.next` from cache. The `serve` target runs Next.js in development mode.
The generated Next.js config keeps development output in `.next-dev` so
development and production builds can run independently.

To serve the production build, run both commands from the workspace root.

```sh
isox build web
isox serve web --configuration=production
```

## Use an existing application

With `next`, `react`, and `react-dom` installed in the app or workspace, add
these targets to the app's `project.json`.

```json
{
  "targets": {
    "build": {
      "executor": "next:build"
    },
    "serve": {
      "executor": "next:serve",
      "configurations": {
        "production": { "mode": "production" }
      }
    }
  }
}
```

Next.js loads its configuration from the project directory. To enable caching
workspace-wide without running the initializer, add these defaults to `isox.json`.

```json
{
  "targetDefaults": {
    "next:build": {
      "cache": true,
      "inputs": ["default", "!{projectRoot}/.next-dev", { "envPrefix": "NEXT_PUBLIC_" }],
      "outputs": ["{projectRoot}/.next"]
    }
  }
}
```

For a custom `distDir` or a static export, set the build target's `outputs` to
the directory your Next.js config produces. Set `cache` to `false` on a target
to disable caching. For static exports and standalone builds, use the
corresponding Next.js deployment workflow to serve the build.

## Build cache inputs

The default hashes the names and values of all environment variables beginning
with `NEXT_PUBLIC_`. Project-local `.env` files are included as file inputs.
Add other build-time environment variables and shared configuration files to
the target's [cache inputs](/docs/cache-inputs). If you already have custom
`next:build` inputs, append `{ "envPrefix": "NEXT_PUBLIC_" }` to enable the
same behavior.

## Executor options

| Option | Targets | Behavior |
| --- | --- | --- |
| `bundler` | build, development serve | Select `turbopack` or `webpack`. By default, use the installed Next.js version's default. |
| `mode` | serve | Use `development` (default) or `production`. Production serves an existing build. |
| `hostname` | serve | Select the server's bind address. |
| `port` | serve | Select the server's port. Use `0` to request an available port. |

The fully scoped executor names are `@isox-sh/next:build` and
`@isox-sh/next:serve`.
