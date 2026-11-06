---
title: "Cache performance and trust"
description: "Understand hashing costs, local cache limits, and trusted cache writers."
icon: "shield-halved"
---

Caching trades execution time for hashing and artifact I/O. Measure the tradeoff for small tasks, and share results only between trusted jobs.

## Cost and limits

Targets without `cache: true` incur no task hashing, log capture or artifact-copy
work. Cacheable invocations request their dependency closure and read declared
file contents, installed tool manifests and executor files before lookup. A miss
checks inputs again after execution before publishing; it also copies outputs.
A hit also rechecks inputs before reuse. Existing outputs are compared by content,
permissions and directory structure, then checked again after input validation.
Tool hashing starts from the executor, core, workspace root, and the selected
project's dependency closure. Workspace and project `devDependencies` are included
because tasks can invoke those tools. Within installed packages, only runtime,
peer and optional dependencies are followed; their own development dependencies
are excluded. A plugin must declare the packages it needs to execute as runtime
or peer dependencies. Lockfiles and full manifest contents still participate in
the key, so changing dependency declarations still invalidates results.

Manifest reads run in bounded parallel batches. `.isox/tools.json` indexes package
lookup directories, including missing directories, to avoid repeated filesystem
searches. Each hash validates directory identities and change times before reusing
listings. Package manifest contents and resolved real paths are still read on each
hash, so edits, new installations, removals and changed symlinks remain detectable.
The index is written atomically, rebuilt when invalid, and removed by `isox reset`.

Small, fast
tasks can still take longer to validate than to execute; use `--skip-cache` when
measuring that tradeoff.
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

[Back to task caching](/docs/task-caching).
