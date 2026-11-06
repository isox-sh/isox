---
title: "Release options"
description: "Configure versioning, synchronized versions, and release commits."
icon: "sliders"
---

Use these options on a `semver:version` target. Start with the [release setup](/docs/semver) for an example you can run with `--dry-run`.

## Version executor options

| Option | Default | Meaning |
| --- | --- | --- |
| `dryRun` | `false` | Preview the release without side effects |
| `skipCommit` | `false` | Stage generated files and tag existing `HEAD` without committing; pushing and post targets still run |
| `syncVersions` | `false` | Version all workspace package manifests together using a shared tag and root changelog |
| `skipProjectChangelog` | `false` | Leave project changelogs untouched; synchronized releases still write the root changelog |
| `commitMessageFormat` | `chore({projectName}): Release {version}` | Commit message with `{projectName}` and `{version}` substitution; ignored with `skipCommit` |
| `releaseAs` | Derived from commits | `major`, `minor`, `patch`, or an exact semantic version |
| `preid` | Unset | Prerelease identifier such as `alpha`; exact `releaseAs` versions take precedence |
| `tagPrefix` | `{projectName}@`, or `v` with `syncVersions` | Tag prefix; supports `{projectName}`; use `v` for a single-package repository |
| `push` | `false` | Push the new tag before post targets; also push the branch atomically unless `skipCommit` is enabled |
| `remote` | `origin` | Configured Git remote used by `push` |
| `postTargets` | `[]` | Ordered target references or objects with `target` and `options` |

A real release requires a clean index and working tree, including untracked files,
full Git history, and tags. Ignored files such as `.isox` do not interfere. Isox
updates package manifests and enabled changelogs, commits them unless
`skipCommit` is set, and creates an annotated tag. An explicit first release can
create an empty release commit if the version is unchanged and changelogs are
disabled. Git hooks remain enabled. Configure Git author identity in CI.

When creating a release commit, pushing requires a branch checkout and pushes
that branch and its new tag atomically. With `skipCommit: true`, Isox pushes only
the new tag, including from detached checkouts. It never force pushes or pushes
other local tags. The remote must support atomic pushes.

Versioning does not cascade dependency bumps, update dependency ranges or
lockfiles, or publish packages automatically.
For generated packages, run `build` as a post target so its output receives the
new manifest version before publishing.

## Synchronized versions

Configure `syncVersions: true` on one coordinating target, typically in a root
`project.json`, and invoke it once for the workspace:

```json
{
  "name": "workspace",
  "targets": {
    "version": {
      "executor": "semver:version",
      "options": {
        "syncVersions": true,
        "skipProjectChangelog": true,
        "commitMessageFormat": "chore(release): Release {version} [skip ci]",
        "postTargets": ["github"]
      }
    }
  }
}
```

Keep the `github` target from the [release setup](/docs/semver#configure-a-release)
and set `push: true` if this target
should push before creating the GitHub release.

```sh
isox version workspace --dry-run
isox version workspace
```

All discovered projects with a versioned `package.json`, including private
packages, participate. The workspace root manifest also participates when it has
a version. Projects with no manifest or no version are left alone. Every
participating manifest must have a valid name and semantic version.

The bump uses commits anywhere inside the workspace, including shared files
outside individual projects. The highest current package version is the baseline
for the first synchronized release. Subsequent releases require all participating
versions to match the latest reachable shared tag, unless `skipCommit` is enabled:
in that mode, manifest versions may lag behind the tag. All participants receive
the new version, including packages without their own changes. There is one tag
and, unless skipped, one commit for the entire release; the default tag prefix is `v`.

A root `CHANGELOG.md` contains the combined notes. By default each participating
project also receives a changelog with its own commits; unchanged projects get a
new version heading. `skipProjectChangelog` suppresses these project files but
keeps the root changelog. A root project shares that file rather than creating a
duplicate. Independent releases with `skipProjectChangelog` write no changelog
files at all. Release notes are still generated for post targets in either mode.

Post targets run **once**, on the coordinating project, using the shared version,
tag, and combined notes. Use explicit `project:target` references or a coordinating
build/publish target when releasing multiple packages. Targets and dependencies
of other participants are not scheduled automatically.

## Skipping the release commit

`skipCommit: true` updates and stages the planned release files, then tags the
existing `HEAD`. It does not skip tagging, an optional push, or post targets.
When `push` is enabled, only the new tag is pushed; branch refs stay unchanged.
`commitMessageFormat` has no effect in this mode. The clean-working-tree
requirement still applies before the release starts.

The updated versions and changelogs remain local staged changes. A pushed tag
therefore references the original source commit, **without** those generated
updates. Post targets run locally after generation, so build/publish targets see
the new manifest versions. Commit the staged files yourself if you want to keep
them in history; a fresh checkout of the tag will still contain the original
manifest versions. Keep `skipCommit` enabled for subsequent releases: the latest
reachable release tag supplies the version baseline, and older manifest versions
are accepted. Manifest versions ahead of that tag still fail validation.

`commitMessageFormat` otherwise supports `{projectName}` and `{version}` anywhere
in the message, including multiline bodies. The message is passed directly to
Git without shell expansion. These booleans and the message can be overridden
from the CLI, for example `--skip-commit`, `--sync-versions`,
`--skip-project-changelog`, and `--commit-message-format='release: {version}'`.

[Back to releases](/docs/semver).
