# @isox-sh/core

Workspace discovery, native command execution, configuration types, logging,
and the built-in shell-command executor for Isox. Requires Node.js 24+.

```sh
npm install --save-dev @isox-sh/core
```

Install directly for API/type imports or schema paths. The `isox` CLI includes
core automatically for built-in commands.

`parseWorkspace` caches project definitions only. `resolveWorkspaceDependencies`
separately validates and reuses per-project analysis in `.isox/discovery.json`
when called. See [cache behavior](https://github.com/isox-sh/isox/blob/main/website/docs/configuration.md#discovery-cache)
for fingerprints, invalidation and reset semantics.

## Documentation

- [Core API and shell commands](https://github.com/isox-sh/isox/blob/main/website/docs/core-api.md)
- [Custom executors and initializers](https://github.com/isox-sh/isox/blob/main/website/docs/custom-executors.md)
- [All documentation](https://github.com/isox-sh/isox/blob/main/website/README.md)

[Website](https://isox.sh) · [Source](https://github.com/isox-sh/isox) ·
[Issues](https://github.com/isox-sh/isox/issues)

MIT.
