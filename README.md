<div align="center">
  <img src="./.github/assets/banner.svg" alt="Isox Banner" width="100%" />

  <br />
  <p><b>A lightweight monorepo command runner with explicit project configuration.</b></p>

  [![npm version](https://img.shields.io/npm/v/isox.svg?style=flat-square&color=3b82f6)](https://npmjs.com/package/isox)
  [![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg?style=flat-square)](https://opensource.org/licenses/MIT)
  [![Website](https://img.shields.io/badge/Website-isox.sh-blue.svg?style=flat-square)](https://isox.sh)
  [![CI](https://img.shields.io/github/actions/workflow/status/isox-sh/isox/ci.yml?style=flat-square&logo=github)](https://github.com/isox-sh/isox/actions)
</div>

<hr />

## What is Isox?

Isox is a lightweight monorepo command runner. Each project defines its commands
in `project.json`, and an `isox.json` marker identifies the workspace root.
A local discovery cache keeps subsequent runs fast, with no background daemon.

Isox currently runs one project's command at a time. Dependency scheduling,
affected detection, task output caching, and distributed execution are planned;
see the [roadmap](ROADMAP.md) for current capabilities and upcoming work.

## Get started

Requires Node.js 24+.

```sh
npm install --save-dev isox
npx isox init
```

Define your project's commands in `project.json`, then run:

```sh
npx isox build my-app
```

Follow the [getting started guide](docs/getting-started.md) for a complete example.

## Documentation

Browse the [documentation](docs/README.md) for configuration, CLI usage, executor
reference, plugin development, and migration guides.

- [CLI reference](docs/cli.md)
- [Workspace and project configuration](docs/configuration.md)
- [ESLint executor](docs/eslint.md)
- [TypeScript executor](docs/typescript.md) and [Vitest executor](docs/vitest.md)
- [Core API](docs/core-api.md) and [custom executors](docs/custom-executors.md)
- [Migrating from Nx](docs/nx-migration.md) — temporary adapter support for Nx 23

## Contributing

See the [contributing guide](docs/contributing.md) for development setup, builds,
tests, and CI. Use [Issues](https://github.com/isox-sh/isox/issues) for individual
work items and the [roadmap](ROADMAP.md) to find planned work.

## License

Distributed under the [MIT License](LICENSE).
