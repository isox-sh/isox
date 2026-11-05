# Isox

A lightweight monorepo command runner with explicit project configuration.
Requires Node.js 24+.

```sh
npm install --save-dev isox
```

Project definitions live in `.isox/workspace.json`. Dependency analysis is cached
separately and checked only when requested; neither cache skips task execution.
Use `isox reset` after project-definition changes before single-project commands.
Source/import edits do not require reset. See
[cache behavior](https://github.com/isox-sh/isox/blob/main/website/docs/configuration.md#discovery-cache).

## Documentation

- [Getting started](https://github.com/isox-sh/isox/blob/main/website/docs/getting-started.md)
- [CLI reference](https://github.com/isox-sh/isox/blob/main/website/docs/cli.md)
- [Workspace configuration](https://github.com/isox-sh/isox/blob/main/website/docs/configuration.md)
- [All documentation](https://github.com/isox-sh/isox/blob/main/website/README.md)

[Website](https://isox.sh) · [Source](https://github.com/isox-sh/isox) ·
[Issues](https://github.com/isox-sh/isox/issues)

MIT.
