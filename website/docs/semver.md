---
title: "Releases"
description: "Version projects from conventional commits, generate changelogs, and run publishing targets."
icon: "tag"
---

`@isox-sh/semver` provides two executors: `semver:version` for local versioning
and `semver:github` for creating GitHub releases. Both also accept the fully
scoped names, such as `@isox-sh/semver:version`.

Requires Node.js 24 or 26+ and a Git repository. Install the plugin at the
workspace root, then add its target to a project with a versioned `package.json`:

```sh
npm install --save-dev @isox-sh/semver
isox add @isox-sh/semver my-package
```

The `add` generator adds this target to an existing `project.json`:

```json
{
  "name": "my-package",
  "targets": {
    "version": {
      "executor": "semver:version"
    }
  }
}
```

The argument is the project name from `project.json`, including for a root
project. You can run the command from any directory inside the workspace.
Install the plugin first; `add` does not install npm
packages or create a new project. It preserves other targets and custom fields,
leaves an existing release `version` target and its options untouched, and rejects
a conflicting target. Discovery is refreshed automatically.

Run `isox version <project-name> --dry-run` to preview. The generator uses default
release options and does not add publishing hooks or perform a release.

Choose a workflow:

- [Independent versions](#configure-a-release) for packages released separately.
- [Alpha and other prereleases](/docs/prereleases#alpha-and-other-prereleases) for preview packages.
- [Synchronized versions](/docs/release-options#synchronized-versions) for one release across the workspace.

The [options reference](/docs/release-options#version-executor-options) lists defaults. The
[publishing example](/docs/prereleases#publish-an-alpha-package-and-create-a-github-release) shows
how to build, publish to npm, and create a GitHub release in order.

## Configure a release

To enable pushing and GitHub releases, extend the generated target and add a
`github` target:

```json
{
  "name": "my-package",
  "targets": {
    "version": {
      "executor": "semver:version",
      "options": {
        "push": true,
        "postTargets": ["build", "github"]
      }
    },
    "github": {
      "executor": "semver:github",
      "options": {
        "tag": "{tag}",
        "title": "my-package {version}",
        "notes": "{notes}"
      }
    }
  }
}
```

Keep your existing `build` target. Post targets are ordinary Isox targets: add an
npm publishing target or another deployment target as needed. This example
builds the newly versioned package and creates a GitHub release; it does not
publish to npm.

```sh
isox version my-package --dry-run
isox version my-package
isox version my-package --release-as=patch
isox version my-package --release-as=2.0.0-beta.1
```

A dry run calculates and logs the version and release notes, validates post-target
references, and skips all writes, commits, tags, pushes, and post targets. It can
preview committed history while the working tree is dirty; uncommitted source
changes are never included in its commit selection.

## How versions are calculated

By default, projects have independent versions. The default tag prefix is `{projectName}@`,
for example `my-package@1.2.0`. Isox selects the highest semantic version among
matching tags reachable from `HEAD`; unrelated projects and tags on unmerged
branches do not influence it. The manifest version must match that tag. On the
first release, `package.json` supplies the starting version and the complete
project history is considered.

Only non-merge commits touching files under the project's directory are included.
The commit scope is descriptive, not a project selector. Changes outside the
project do not cause a release. Nested project directories are included in their
parent directory's history.

| Commit | Bump |
| --- | --- |
| Any conventional commit with `!`, `BREAKING CHANGE:`, or `BREAKING-CHANGE:` | Major |
| `feat`, `feature` | Minor |
| `fix`, `perf`, `revert` | Patch |
| Other types or non-conventional messages | None |

Parsing, bump recommendations, and Markdown formatting use the
[Conventional Changelog Conventional Commits preset](https://github.com/conventional-changelog/conventional-changelog/tree/master/packages/conventional-changelog-conventionalcommits).
Isox supplies the project-specific commit range. A commit and its revert within
that range cancel each other out for both versioning and notes. Reverting a
commit from an earlier release produces a patch release, including Git's default
`Revert` messages.

The largest bump wins, including for `0.x` versions: a breaking change moves to
`1.0.0`. Notes group breaking changes, features, fixes, performance changes, and reverts,
with commit hashes. Old changelog entries are preserved. No releasable commits
means a successful no-op: no new tag and no post targets.

Use `releaseAs` to override the bump or choose an exact version. An exact version
must be newer than the previous release; the first release may use the manifest's
existing version. Use `preid` for prereleases and `syncVersions` to release
packages together.

## Alpha and other prereleases

See [Alpha and other prereleases](/docs/prereleases#alpha-and-other-prereleases).

### Publish an alpha package and create a GitHub release

See [Publish an alpha package and create a GitHub release](/docs/prereleases#publish-an-alpha-package-and-create-a-github-release).

### Publish multiple projects with one shared version

See [Publish multiple projects with one shared version](/docs/prereleases#publish-multiple-projects-with-one-shared-version).

## Version executor options

See [Version executor options](/docs/release-options#version-executor-options).

## Synchronized versions

See [Synchronized versions](/docs/release-options#synchronized-versions).

## Skipping the release commit

See [Skipping the release commit](/docs/release-options#skipping-the-release-commit).

## Post targets

See [Post targets](/docs/release-publishing#post-targets).

## GitHub executor

See [GitHub executor](/docs/release-publishing#github-executor).

## CI and multiple projects

See [CI and multiple projects](/docs/release-publishing#ci-and-multiple-projects).

## Recovering from failure

See [Recovering from failure](/docs/release-publishing#recovering-from-failure).
