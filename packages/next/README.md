# @isox-sh/next

Build and serve Next.js applications with Isox. Requires Node.js 24 or 26+.
Install the CLI and plugin in the workspace root.

```sh
npm install --save-dev @isox-sh/cli @isox-sh/next
```

For a new workspace, run `npx isox init` once to create `isox.json`. Create a
Next.js App Router application in a new directory.

```sh
npx isox init @isox-sh/next apps/web
npm install
npx isox serve web --port=4200
```

The initializer adds Next.js and React to the workspace root. To serve an
optimized production build, run these commands from the workspace root.

```sh
npx isox build web
npx isox serve web --configuration=production
```

For an existing Next.js app, add `next:build` and `next:serve` to its
`project.json`. The executors use the Next.js installation available to the app
and run from its project directory.

- [Next.js executor guide](https://github.com/isox-sh/isox/blob/main/website/docs/next.md)
- [All documentation](https://github.com/isox-sh/isox/blob/main/website/README.md)

[Website](https://isox.sh) · [Source](https://github.com/isox-sh/isox) ·
[Issues](https://github.com/isox-sh/isox/issues)

MIT.
