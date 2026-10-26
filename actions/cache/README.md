# Isox cache action

Restore the workspace's `.isox` directory before running Isox, then automatically
save an updated snapshot after the job succeeds. Place the action after checkout
and Node.js setup, before any Isox commands:

```yaml
- uses: actions/checkout@v7
- uses: actions/setup-node@v7
  with:
    node-version: '24'
- uses: isox-sh/isox/actions/cache@main
- run: npm ci
- run: npx isox run-many --target=test
```

The repository's shared `setup-isox` action includes this step before bootstrap.
The cache action itself does not require an installed Isox CLI.

## Sharing between runners and future runs

Cache families are scoped by namespace, runner OS, architecture, and workspace
location relative to the checkout. Commit IDs, branches, and job names are not
part of the restore prefix, so later commits and compatible runners can reuse
the most recent snapshot permitted by GitHub's cache scope.

GitHub cache entries are immutable. Each invocation generates a unique save key
and restores through the shared prefix. The nested
[`actions/cache`](https://github.com/actions/cache) action registers its own
post-job save, so the snapshot contains changes made by later steps. Failed or
cancelled jobs do not save snapshots. There is no exact-hit shortcut that prevents
successful jobs from publishing updated state.

Parallel jobs each save their own snapshot. GitHub restores the most recently
created matching snapshot; it does not merge entries or synchronize running jobs.
Forks and branches follow [GitHub's cache access rules](https://docs.github.com/en/actions/reference/workflows-and-actions/dependency-caching#restrictions-for-accessing-a-cache).

## Trust boundary

The shared prefix is a lookup convenience, not a permission boundary. This action
relies on GitHub to isolate PR caches from trusted branch consumers. Do not copy
PR-produced state into privileged jobs or reuse a writable local `.isox` across
trust levels. This applies to private repositories as well as public ones.

Checksums detect corruption, not a malicious producer. Read the
[CREEP/cache-poisoning guidance](../../website/docs/task-caching.md#cache-poisoning-and-trust-boundaries)
before using this action in privileged workflows or on persistent runners.
The repository's release workflow deliberately does not restore this cache and
sets `ISOX_SKIP_CACHE=1`; the publishing script also forces uncached builds.

## What is restored

The directory can contain dependency analysis, TypeScript state, and local task
results. Targets explicitly configured for [task caching](../../website/docs/task-caching.md)
can reuse matching results. Other builds, tests, and lint targets still execute.

After restoration, the action removes only `.isox/workspace.json`. Single-project
commands otherwise trust those definitions until reset, so retaining a previous
commit's definitions could use stale targets or miss new projects. The next Isox
command rebuilds them. Dependency analysis validates its own inputs when requested;
the action retains that data and the rest of `.isox`. It does not run `isox reset`.

Output directories outside `.isox` and installed dependencies are not restored
directly. Cached task entries can contain copies of declared outputs; running
the matching target restores them on a hit. Prepare prerequisite outputs and
install dependencies as usual. Keep this action before builds and
stop background builds before the job finishes so transient locks are not saved.

## Inputs and outputs

| Input | Default | Purpose |
| --- | --- | --- |
| `workingDirectory` | `.` | Workspace directory inside `GITHUB_WORKSPACE` |
| `prefix` | `isox-v1` | Namespace; change it to start a new cache family |

| Output | Purpose |
| --- | --- |
| `cache-key` | Unique save key for this invocation |
| `cache-prefix` | Shared restore prefix for compatible snapshots |

For a nested workspace:

```yaml
- uses: isox-sh/isox/actions/cache@main
  with:
    workingDirectory: tools/workspace
    prefix: isox-v2
```
