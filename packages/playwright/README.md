# @isox-sh/playwright

Native Playwright Test executor and CI shard planner for Isox. Requires Node.js
24 or 26+.

```sh
npm install --save-dev @isox-sh/playwright @playwright/test
```

Add a `playwright:test` target to an existing project named `web`, then run its
suite or plan the CI jobs. Install the browsers your suite uses on each worker.

```sh
npx isox add @isox-sh/playwright web
npx isox e2e web
npx isox plan --all --target=e2e --max-jobs=4
```

The generator declares the plugin and test runner in the workspace root's
`package.json`. The generated `e2e` target uses `planner.shards: "auto"` to
split runnable tests within the CI job budget. Set `planner.shards` to a number
for an exact job count. To replay one shard, run `npx isox e2e web --shard=2/4`.

## Documentation

- [Playwright executor guide](https://github.com/isox-sh/isox/blob/main/website/docs/playwright.md)
- [All documentation](https://github.com/isox-sh/isox/blob/main/website/README.md)

[Website](https://isox.sh) · [Source](https://github.com/isox-sh/isox) ·
[Issues](https://github.com/isox-sh/isox/issues)

MIT.
