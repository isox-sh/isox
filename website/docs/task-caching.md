---
title: "Local task caching"
description: "Opt native targets into deterministic hashing, output restoration, and terminal log replay."
icon: "database"
---

Task caching skips a native executor when a successful result exists for the same
inputs. It is separate from [workspace discovery and dependency analysis](/docs/configuration#discovery-cache).
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

A hit reports `Cache hit for web:build` before replaying saved terminal output.
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

`inputs` is an array of file patterns and `{ "env": "NAME" }` declarations. Omit it
to include all files under the project root. An explicit array **replaces** that
default; `[]` declares no project file or environment inputs. Shared workspace
metadata and dependency inputs still participate.

- Paths and globs are relative to the workspace. `{projectRoot}` and
  `{workspaceRoot}` and `{projectName}` are available; use `/` separators on every platform.
- Prefix a pattern with `!` to exclude matches. Exclusions always win. Literal
  directories include their descendants. Hidden files are included.
- `.gitignore` and `.isoxignore` govern discovery, **not task input matching**.
  Ignored files can affect a build, so include or exclude them explicitly here.
- `.git`, `.isox`, `node_modules`, and the current target's output directories
  are excluded from file inputs. Declare other generated directories as exclusions.
- Files outside the project can be included as workspace-relative paths. Paths
  outside the workspace, traversal through `..`, and selected symlinks are rejected.
  Installed executor packages are handled separately.
- File paths, contents and permission bits participate. Timestamps and inode
  identities do not. Missing literals or empty matches are valid: creating a
  matching file changes the key. Empty input directories alone do not affect it.
- Only declared environment variables participate. An unset variable differs
  from an empty value. Declare every variable that affects the task's result.

The SHA-256 key also includes effective options after configuration and CLI
overrides, the selected configuration name, project definitions, and inputs of
transitive project dependencies. For each dependency, Isox uses its same-named
target's inputs, or all of its project files if those are unspecified. Its target
configuration and applicable named/default options participate too. For cacheable
dependency targets, their actual declared output files also participate, so a
newly rebuilt dependency invalidates consumers even if its sources are unchanged.
This computes inputs; it does **not execute prerequisite tasks**. Prepare dependency
outputs before running consumers. Explicitly include any other generated artifacts
the task reads (for example, build outputs used by a `test` target) in `inputs`.

Root `package.json`, `isox.json`, `tsconfig.json`, `tsconfig.base.json`, ignore
files, and supported npm/pnpm/Yarn/Bun lockfiles participate automatically.
Executor package contents (including local compiled implementations), the running
core package's files, installed
package manifests/versions, Node and its component versions, OS release,
architecture, endianness, and the absolute workspace path also participate.
Installed dependency contents are assumed to match their manifests and lockfile;
record patched dependencies in the lockfile. External tools and configuration not
represented by these inputs need explicit file/environment declarations.
Keys conservatively differ across checkout paths and runtime/platform changes.

## Output ownership and recovery

`outputs` is optional, including when `cache` is `true`. When omitted after target
defaults are merged, only the successful result and terminal logs are cached.
When provided, it is an array of concrete,
exclusively owned **directories**, with the same path tokens. Globs, individual
files, workspace/project roots, reserved directories, and overlapping declarations
are rejected. Use `outputs: []` to override inherited output directories and cache
only logs. Executors that produce reusable files must declare those directories
to restore them on a cache hit.

Declaring an output makes it disposable. Before a finite execution, including
`--skip-cache`, Isox moves existing output directories into temporary backups.
A successful execution discards those backups. A handled failure or cancellation
removes partial outputs and restores the previous directories. Watch mode clears
outputs before its initial build and keeps its latest results when stopped.
On a cache hit, Isox replaces outputs with the recorded tree, removing stale files.

In Git workspaces, output directories containing tracked files are rejected before
replacement or execution. A failure to inspect the Git index stops the operation.
This check also applies to staged files and workspaces nested inside a repository.
Keep untracked source files and manually maintained assets outside output
directories too; Isox cannot identify those automatically.
Missing output directories are recorded as
missing; empty directories and file permissions are preserved. Symlink artifacts
and symlink output paths are rejected.

This replacement contract also lets a restored TypeScript package rebuild after
its `.isox/tsc` ownership state has been lost. Uncached targets keep their existing
executor-specific cleanup behavior.

Successful finite tasks publish artifacts, terminal logs and metadata atomically
under `.isox/tasks/<hash>`. A changed input during execution prevents publication.
Failed, cancelled, empty-result and continuous runs cannot publish successful
entries. Terminal capture covers Node stdout/stderr writes and children launched
through core's `runProcess`; custom plugins should use these APIs rather than
writing directly to file descriptors or inheriting unmanaged child output. Logs
over 16 MiB or 65,536 nonempty writes still print live but prevent caching that
execution. The write-count limit bounds the overhead of many tiny chunks. Cache metadata is
limited to 64 MiB; oversized entries are ignored and oversized new entries are not
stored. Metadata reads are bounded before parsing.

Restoration verifies every artifact in staging before replacing outputs and
rolls back a partial restore on error. Incomplete or corrupt entries cause a miss.
Concurrent cache publishers cannot expose partial entries. Overlapping output
owners fail with a diagnostic instead of writing simultaneously.

A forced kill or machine failure can interrupt cleanup and leave a lock and
backups. Stop active tasks before recovery. For interrupted executions,
`.isox/tasks/<id>.run/outputs.json` maps numbered backup directories to their
workspace destinations. Restore any needed backups before `isox reset`, which
also deletes them. Failed cache restores may leave numbered `.previous`
directories and an `outputs.json` map in a `.restore` folder. These are recovery copies, not automatically
resumed transactions; a rebuild may be necessary after an abrupt termination.

`isox reset` removes **all** `.isox` data: result entries, workspace definitions,
dependency analysis, compiler state and locks. It leaves compiled output in place.
There is no automatic eviction yet; reset is also the disk-space cleanup control.

## Cost and limits

Targets without `cache: true` incur no task hashing, log capture or artifact-copy
work. Cacheable invocations request their dependency closure and read declared
file contents, installed tool manifests and executor files before lookup. A miss
checks inputs again after execution before publishing; it also copies outputs.
Preserving previous outputs uses directory renames on the same filesystem and
temporarily retains both old and new output trees. Git output checks inspect the
index for declared directories; tasks with no outputs skip that check.
A hit stages and validates cached outputs, rechecks inputs before replacement,
and replays logs. Cost grows with selected
input bytes, installed tool metadata, and output bytes, rather than only changed
file counts. Narrow `inputs` carefully for large projects, without omitting real
inputs.

Cache entries are trusted local data. Checksums detect accidental corruption;
they do not authenticate whoever wrote an entry. Share caches only across trusted
jobs, and avoid storing secrets in terminal output. Executors are not sandboxed:
undeclared file reads, environment variables, external services and side effects
remain the target author's responsibility. Do not run `isox reset` during active
tasks, or let other tools modify their output directories concurrently.
Project definitions retain the manual workspace-reset behavior; after editing
`project.json` or `isox.json.targetDefaults`, reset or explicitly rediscover the
workspace before execution.

## Cache poisoning and trust boundaries

[CVE-2025-36852 (CREEP)](https://nx.dev/blog/cve-2025-36852-critical-cache-poisoning-vulnerability-creep)
describes an untrusted build publishing poisoned results before a trusted build
requests the same task hash. The artifact can have valid checksums because it was
already malicious when packaged. Extra hashing, encryption and immutable cache
entries do not establish who is allowed to produce trusted results.

**This is not limited to open-source projects.** Private repositories also need
isolation when PR authors or feature-branch jobs are less trusted than release
jobs. The relevant boundary is publisher authority, not repository visibility.

Isox has no native cloud-storage adapter yet. Its local cache assumes trusted
writers: anyone able to modify `.isox` can fabricate a successful result. Never
share a writable `.isox` directory between untrusted builds and trusted jobs,
including on persistent self-hosted runners. `--skip-cache` bypasses task-result
reuse; it does not sanitize restored discovery/compiler state. Use a clean
workspace for a release rather than importing untrusted state.

The GitHub cache action delegates access control to GitHub. Normal `pull_request`
caches are scoped to the PR merge ref and cannot be restored by the base branch.
Matching Isox prefixes do not bypass that isolation. Jobs executing untrusted code
in a privileged context, such as unsafe `pull_request_target` or `workflow_run`
flows, require separate review; do not grant them shared cache write access or
copy their results into a release cache. See
[GitHub's cache restrictions](https://docs.github.com/en/actions/reference/workflows-and-actions/dependency-caching#restrictions-for-accessing-a-cache).

Future cloud caching must enforce producer identity, isolated write scopes and
trusted-consumer rules on the server. Merely putting a branch name into a key is
not sufficient. See the [remote-cache security checklist](https://github.com/isox-sh/isox/blob/main/ROADMAP.md#required-cloud-cache-security-boundary).
