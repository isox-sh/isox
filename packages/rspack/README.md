# @isox-sh/rspack

Native Rspack build and development server executors for Isox. Requires Node.js
24 or 26+.

```sh
npm install --save-dev @isox-sh/rspack
```

Create an app in a new directory, then build it or start its development server.

```sh
npx isox init @isox-sh/rspack apps/web
npm install
npx isox build web
npx isox serve web --port=4200
```

The initializer adds Rspack dependencies to the workspace root's `package.json`.
The generated `rspack:build` target caches the app's `dist` directory. Both
`rspack:build` and `rspack:serve` use the app's `rspack.config.mjs`, which reads
workspace library aliases from `tsconfig.base.json` when present.

## Documentation

- [Rspack executor guide](https://github.com/isox-sh/isox/blob/main/website/docs/rspack.md)
- [All documentation](https://github.com/isox-sh/isox/blob/main/website/README.md)

[Website](https://isox.sh) · [Source](https://github.com/isox-sh/isox) ·
[Issues](https://github.com/isox-sh/isox/issues)

MIT.
