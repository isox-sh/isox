# @isox-sh/rspack

Native Rspack build and development server executors for Isox. Requires Node.js
24 or 26+. Install the CLI and plugin in the workspace root.

```sh
npm install --save-dev @isox-sh/cli @isox-sh/rspack
```

For a new workspace, run `npx isox init` once to create `isox.json`. From the
workspace root, create the app in a new directory, then build or serve it.

```sh
npx isox init @isox-sh/rspack apps/web
npm install
npx isox build web
npx isox serve web --port=4200
```

The initializer adds Rspack dependencies to the workspace root's `package.json`.
The generated `build` target caches the app's `dist` directory. The `rspack:build`
and `rspack:serve` executors use the app's `rspack.config.mjs`, which reads
workspace library aliases from `tsconfig.base.json` when present.

## Documentation

- [Rspack executor guide](https://github.com/isox-sh/isox/blob/main/website/docs/rspack.md)
- [All documentation](https://github.com/isox-sh/isox/blob/main/website/README.md)

[Website](https://isox.sh) · [Source](https://github.com/isox-sh/isox) ·
[Issues](https://github.com/isox-sh/isox/issues)

MIT.
