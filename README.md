<div align="center">
  <img src="./.github/assets/banner.svg" alt="Isox Banner" width="100%" />

  <br />
  <p><b>A lean, hermetic monorepo task orchestrator and drop-in Nx executor runner.</b></p>
  
  [![npm version](https://img.shields.io/npm/v/@isox-sh/cli.svg?style=flat-square&color=3b82f6)](https://npmjs.com/package/@isox-sh/cli)
  [![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg?style=flat-square)](https://opensource.org/licenses/MIT)
  [![Website](https://img.shields.io/badge/Website-isox.sh-blue.svg?style=flat-square)](https://isox.sh)
  [![CI](https://img.shields.io/github/actions/workflow/status/isox-sh/isox/ci.yml?style=flat-square&logo=github)](https://github.com/isox-sh/isox/actions)
</div>

<hr />

## ⚡ What is Isox?

Isox is an ultra-lightweight, high-performance monorepo task orchestrator. It was built to solve a specific problem: **We wanted the power of Nx's `project.json`, plugin ecosystem, and executors, but without the heavy background daemons, bloated dependencies, and aggressive caching wrappers.**

Isox acts as a **drop-in replacement** for the core execution engine of Nx. It evaluates your dependency graph, computes affected projects based on pure `git` diffs, and orchestrates tasks in a hermetic, distributed manner.

---

## 🎯 Core Pillars

- **Drop-in Nx Compatibility (`project.json`)**: You don't need to rewrite your workspace. Isox natively parses `project.json` and supplies a compatible `ExecutorContext` to run existing Nx plugins (like `@nx/js:tsc` or `@nx/vite:build`).
- **Hermetic by Default (`Iso-`)**: Strict I/O boundaries. Tasks run in isolated environments without leaking undeclared global environment variables or rogue file reads.
- **Affected Detection**: Trims away untouched packages by calculating `git merge-base` diffs. Splices together only the active targets to save CI time.
- **Distributed Execution**: Instead of paying for a proprietary cloud, Isox natively integrates with GitHub Actions matrixes (via `@isox-sh/actions`) for effortless horizontal scaling.
- **Distributed Computation Caching**: Deterministic caching via `xxhash-wasm`. Push and pull artifacts directly to/from S3 (via `@isox-sh/cache-s3`).
- **Zero Daemons**: No background AST-parsing daemons eating up your RAM. Just pure, on-demand execution (`-ox`).

---

## 🚀 Quick Start

### Installation

Install Isox globally via npm:
```bash
npm install -g @isox-sh/cli
```

Or use our standalone installer:
```bash
curl -fsSL https://isox.sh/install | bash
```

### Basic Commands

```bash
# Run a specific target on a specific project
isox run my-app:build

# Run a target on all projects
isox run-many --target=lint

# Run affected projects based on the current Git diff
isox affected --target=test --base=origin/main
```

---

## 🏗️ Architecture & Roadmap (What We Are Building)

Isox is structured as a monorepo itself, dogfooding its own execution engine.

### 1. The Core Engine (`@isox-sh/core`)
Unlike heavy orchestrators, Isox relies purely on `fast-glob` to index `project.json` files and `package.json` dependencies. It builds a Directed Acyclic Graph (DAG) in milliseconds.

### 2. The Executor Bridge
To maintain backward compatibility with Nx, Isox mocks the Nx `ExecutorContext`. It locates the executor implementation via `executors.json` and runs it natively.

```typescript
// How Isox runs an Nx Executor under the hood
const executorFn = require(executorPath).default;
const context = createIsoxContext(projectName, workspaceGraph);
await executorFn(options, context);
```

### 3. Distributed Task Execution (DTE)
Using `@isox-sh/actions`, you can pipe the output of `isox affected --print-matrix` directly into GitHub Actions:

```yaml
jobs:
  calculate-matrix:
    outputs:
      matrix: ${{ steps.set-matrix.outputs.matrix }}
    steps:
      - run: echo "matrix=$(isox affected --target=build --print-matrix)" >> $GITHUB_OUTPUT

  build:
    needs: calculate-matrix
    strategy:
      matrix:
        project: ${{ fromJson(needs.calculate-matrix.outputs.matrix) }}
    steps:
      - run: isox run ${{ matrix.project }}:build
```

---

## 🤝 Contributing

We are actively building out the core engine. Check out the [Issues](https://github.com/isox-sh/isox/issues) page to see the roadmap, or submit a PR! 

The repository uses pnpm workspaces, with packages under `packages/`. Install
[pnpm](https://pnpm.io/installation) using the version pinned in `package.json`,
then run `pnpm install` from the repository root. Commit changes to
`pnpm-lock.yaml` alongside dependency updates; use `pnpm install --frozen-lockfile`
in CI. Build and test scripts will be added alongside the implementation.

1. Fork the repo
2. Create your feature branch (`git checkout -b feature/amazing-feature`)
3. Commit your changes (`git commit -m 'Add amazing feature'`)
4. Push to the branch (`git push origin feature/amazing-feature`)
5. Open a Pull Request

## 📝 License

Distributed under the [MIT License](https://opensource.org/licenses/MIT). See `LICENSE` for more information.
