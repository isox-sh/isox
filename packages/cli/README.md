# @isox-sh/cli

The Isox command-line interface. Define commands in `project.json`, run individual
projects, or select affected projects from Git changes. Requires Node.js 24+.

## Get started

Install the package in your workspace, then initialize it:

```sh
npm install --save-dev @isox-sh/cli
npx isox init
```

The package is named `@isox-sh/cli`; the command is `isox`. The CLI includes
`@isox-sh/core` for built-in commands. With pnpm or Yarn, run the local binary
with `pnpm exec isox` or `yarn isox`.

Follow the getting started guide below to define your first project. Once it has
a `build` target, run it with:

```sh
npx isox build my-app
```

## Upgrading

```sh
isox migrate latest
pnpm install # or npm install / yarn install
isox migrate --run-migrations
```

Review the dependency updates and generated `migrations.json` before installing.
You can pass an exact version instead of `latest`. See the CLI reference for
migration plans and publishing package migrations.

## Documentation

- [Getting started](https://github.com/isox-sh/isox/blob/main/website/docs/getting-started.md)
- [CLI reference](https://github.com/isox-sh/isox/blob/main/website/docs/cli.md)
- [Workspace configuration](https://github.com/isox-sh/isox/blob/main/website/docs/configuration.md)
- [All documentation](https://github.com/isox-sh/isox/blob/main/website/README.md)

[Website](https://isox.sh) · [Source](https://github.com/isox-sh/isox) ·
[Issues](https://github.com/isox-sh/isox/issues)

MIT.
