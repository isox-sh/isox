# @isox-sh/js

Native TypeScript 7 compiler executor and project initializer for Isox.
Requires Node.js 24+.

```sh
npm install --save-dev @isox-sh/js
```

The compiler still runs on every build. Workspace alias remapping can reuse
dependency analysis from `.isox/discovery.json`; changed source metadata causes
the invalidated project's included sources, including tests, to be reanalyzed.
Package generation performs its own build-specific dependency analysis. See
[cache behavior](https://github.com/isox-sh/isox/blob/main/website/docs/configuration.md#discovery-cache).

## Documentation

- [TypeScript executor guide](https://github.com/isox-sh/isox/blob/main/website/docs/typescript.md)
- [All documentation](https://github.com/isox-sh/isox/blob/main/website/README.md)

[Website](https://isox.sh) · [Source](https://github.com/isox-sh/isox) ·
[Issues](https://github.com/isox-sh/isox/issues)

MIT.
