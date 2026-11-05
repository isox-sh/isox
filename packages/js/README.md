# @isox-sh/js

Native TypeScript 7 compiler executor and project initializer for Isox.
Requires Node.js 24+.

```sh
npm install --save-dev @isox-sh/js
```

The initializer registers local task caching defaults while preserving existing
settings, including cache opt-outs. A cache hit restores outputs and skips
compilation; use `--skip-cache` to force a build. Existing targets can opt in with `cache: true` and output declarations.
See [task caching](https://isox.sh/docs/task-caching) and the TypeScript guide for
configuration and output ownership.

Dependency analysis has its own cache. Reusing that analysis alone does not skip
compilation. See [discovery caching](https://isox.sh/docs/configuration#discovery-cache).

## Documentation

- [TypeScript executor guide](https://github.com/isox-sh/isox/blob/main/website/docs/typescript.md)
- [All documentation](https://github.com/isox-sh/isox/blob/main/website/README.md)

[Website](https://isox.sh) · [Source](https://github.com/isox-sh/isox) ·
[Issues](https://github.com/isox-sh/isox/issues)

MIT.
