---
title: "Local task caching"
description: "Opt native targets into deterministic hashing, output restoration, and terminal log replay."
icon: "database"
---

Task caching skips a native executor when a successful result exists for the same
inputs. It is separate from [workspace discovery and dependency analysis](/docs/discovery-cache#discovery-cache).
Targets opt in with `cache: true`, locally or through
[workspace target defaults](/docs/configuration#target-defaults). The JS initializer
and Vitest add generator register cache defaults when missing.

All three native build, lint, and test plugins support terminal log caching through
core. `cache`, `inputs`, and `outputs` belong on the target or its workspace defaults,
not inside executor `options`.

| Executor | Default reusable result | Output declaration |
| --- | --- | --- |
| `js:tsc` | Compiled files, copied assets, generated package metadata, and terminal logs | The compiler's output directory |
| `eslint:lint` | Successful lint result and terminal logs | Omit `outputs` |
| `vitest:test` | Successful test result and terminal logs | Omit `outputs` |

Lint and test targets do not need an artifact directory. If a test configuration
writes coverage or reports that must be restored, explicitly declare those
directories as outputs. Include shared ESLint/Vitest configuration, imported
configuration helpers, and files outside the project that the tools read in
`inputs`. Cache inputs are not inferred from tool configuration.

## Enable a target

```json
{
  "name": "web",
  "targets": {
    "build": {
      "executor": "js:tsc",
      "cache": true,
      "inputs": [
        "{projectRoot}/**/*",
        "{workspaceRoot}/tsconfig.base.json",
        "!{projectRoot}/scratch/**",
        { "env": "NODE_ENV" }
      ],
      "outputs": ["{workspaceRoot}/dist/web"],
      "options": {
        "tsConfig": "apps/web/tsconfig.build.json",
        "generatePackageJson": true
      },
      "configurations": {
        "acc": { "generatePackageJson": true }
      }
    }
  }
}
```

Configure the compiler's `outDir` to match `dist/web`. Output declarations do not
change executor options. After editing a project definition, run `isox reset`
before using a single-project command.

```sh
isox build web --config=acc  # Execute and save a successful result
isox build web --config=acc  # Restore outputs and replay terminal logs
isox build web --skip-cache # Execute without reading or writing results
isox reset                 # Clear everything under .isox
```

For a single project, a hit reports `Cache hit for web:build` before replaying saved terminal output.
Multi-project runs show `✔ isox run web:build [local cache]` instead. The live
display and ordinary static output hide successful tool output. GitHub Actions
includes it inside each task's collapsible log group; verbose execution streams it. Cached output contains tool diagnostics, without replaying old task
start or completion messages.
A miss is logged before execution only with `--verbose`. Replayed terminal output comes from the
original execution, including any durations it printed. `--skip-cache` also works
with `run`, `run-many`, and `affected`; workers apply it to all pre/main/post stages.
Set `ISOX_SKIP_CACHE=1` to bypass results throughout a process tree.

Only enable caching for deterministic tasks whose complete observable result is
the declared output directories and terminal logs. Publishing, deployment,
release versioning, network services, and tasks with external side effects must
remain uncached. Watch mode (`watch: true`), dry runs (`dryRun: true`), and Nx
adapter execution bypass result caching. Continuous executor results are never
stored, even when the executor does not use a `watch` option.

## Inputs and the key

See [Inputs and the key](/docs/cache-inputs#inputs-and-the-key).

## Named inputs

See [Named inputs](/docs/cache-inputs#named-inputs).

## Output ownership and recovery

See [Output ownership and recovery](/docs/cache-outputs#output-ownership-and-recovery).

## Cost and limits

See [Cost and limits](/docs/cache-limits#cost-and-limits).

## Cache poisoning and trust boundaries

See [Cache poisoning and trust boundaries](/docs/cache-limits#cache-poisoning-and-trust-boundaries).
