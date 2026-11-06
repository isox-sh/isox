---
title: "Cache outputs and recovery"
description: "Declare disposable output directories and recover interrupted tasks."
icon: "file-export"
---

Output directories are disposable: Isox can replace their entire contents. Declare only generated files here, and keep source files elsewhere.

## Output ownership and recovery

`outputs` is optional, including when `cache` is `true`. When omitted after target
defaults are merged, only the successful result and terminal logs are cached.
When provided, it is an array of concrete,
exclusively owned **directories**, with the same path tokens. Globs, individual
files, workspace/project roots, reserved directories, and overlapping declarations
are rejected. Use `outputs: []` to override inherited output directories and cache
only logs. Executors that produce reusable files must declare those directories
to restore them on a cache hit.

### Replacement behavior

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

### Storage and validation

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

Cache hits verify the cached artifacts even when workspace outputs already match.
Matching outputs stay in place, preserving their files and timestamps. When outputs
differ, restoration verifies every artifact in staging before replacing outputs and
rolls back a partial restore on error. Incomplete or corrupt entries cause a miss.
Concurrent cache publishers cannot expose partial entries. Overlapping output
owners fail with a diagnostic instead of writing simultaneously.

### Recover an interrupted task

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

[Back to task caching](/docs/task-caching).
