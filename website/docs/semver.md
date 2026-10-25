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
- [Alpha and other prereleases](#alpha-and-other-prereleases) for preview packages.
- [Synchronized versions](#synchronized-versions) for one release across the workspace.

The [options reference](#version-executor-options) lists defaults. The
[publishing example](#publish-an-alpha-package-and-create-a-github-release) shows
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

Set `preid: "alpha"` in the version target's options or pass it on the CLI:

```sh
isox version workspace --preid=alpha --dry-run
isox version workspace --preid=alpha
```

The conventional-commit bump determines the stable version being prepared. For
example, a breaking change from `0.0.1` becomes `1.0.0-alpha.0`. Further releasable
changes increment the counter (`1.0.0-alpha.1`, `1.0.0-alpha.2`). If a change
requires a higher stable version, a new sequence starts: a feature from
`1.0.1-alpha.2` becomes `1.1.0-alpha.0`. With no releasable commits, the command
still does nothing unless `releaseAs` is supplied.

Changing `preid` to `beta` starts at `.0` for that identifier. Versions must always
increase; switching from `beta` back to `alpha` on the same base version is
rejected. Valid identifiers include `alpha`, `beta`, `rc`, and `alpha.preview`.

An exact `releaseAs` overrides `preid`, including one saved in project options.
To promote `1.0.0-alpha.2` to stable without requiring new commits:

```sh
isox version workspace --release-as=1.0.0
```

The prerelease version is used in every participating manifest, changelog, Git
tag, and post-target `{version}` / `{tag}` placeholder. `syncVersions` and
`skipCommit` keep their normal behavior. History is measured from the latest
matching release tag, including prerelease tags; each changelog entry contains
changes since that tag.

### Publish an alpha package and create a GitHub release

This example belongs to a project named `my-package` in `packages/my-package`.
It builds into `dist/my-package`, publishes the generated package to npm, and
creates a GitHub release. Install `@isox-sh/js` for the build target and adjust
the TypeScript configuration path to your project.

```json
{
  "name": "my-package",
  "targets": {
    "version": {
      "executor": "semver:version",
      "options": {
        "preid": "alpha",
        "push": true,
        "postTargets": ["build", "publish", "github"]
      }
    },
    "build": {
      "executor": "js:tsc",
      "options": {
        "tsConfig": "packages/my-package/tsconfig.build.json",
        "generatePackageJson": true
      }
    },
    "publish": {
      "executor": "core:run-command",
      "options": {
        "command": "npm publish ./dist/my-package --access public --tag {npmTag}"
      }
    },
    "github": {
      "executor": "semver:github",
      "options": {
        "tag": "{tag}",
        "title": "my-package {version}",
        "notes": "{notes}",
        "prerelease": "{prerelease}"
      }
    }
  }
}
```

Authenticate npm and the GitHub CLI before releasing. The version target commits
the updated manifest and changelog, creates and pushes the Git tag, then runs
`build`, `publish`, and `github` in that order. The build reads the updated version.

After editing `project.json`, refresh workspace discovery and preview the release:

```sh
isox reset
isox version my-package --dry-run
```

When ready, run the release. Later, switch to beta or promote the pending version
to stable:

```sh
# Publish the calculated alpha version.
isox version my-package

# Switch to beta, explicitly requesting a release even without new commits.
isox version my-package --preid=beta --release-as=patch

# If the pending version is 1.0.0-beta.0, publish stable 1.0.0.
isox version my-package --release-as=1.0.0
```

Choose the stable version matching your actual prerelease. The exact version
wins over the configured `preid`, so the same publishing targets work for stable
releases. Remove `preid` from the configuration when future releases should also
be stable, then refresh discovery again.

The post-target values follow the final version:

| Final version | `{preid}` | `{npmTag}` | `{prerelease}` |
| --- | --- | --- | --- |
| `1.0.0-alpha.0` | `alpha` | `alpha` | `true` |
| `1.0.0-beta.2` | `beta` | `beta` | `true` |
| `1.0.0` | Empty string | `latest` | `false` |

`"{prerelease}"` becomes a boolean before the GitHub executor runs, despite being
written as a string in JSON. Placeholders resolve only when called through release
`postTargets`; invoking `publish` or `github` directly requires concrete options.

### Publish multiple projects with one shared version

Use a root project as the release coordinator. In this example, `utils` and
`api-client` each define their own `build` and `publish` targets as above, with
matching TypeScript and output paths. Their `publish` commands use `{npmTag}`.

```json
{
  "name": "workspace",
  "targets": {
    "version": {
      "executor": "semver:version",
      "options": {
        "syncVersions": true,
        "skipProjectChangelog": true,
        "preid": "alpha",
        "push": true,
        "postTargets": [
          "utils:build",
          "api-client:build",
          "utils:publish",
          "api-client:publish",
          "workspace:github"
        ]
      }
    },
    "github": {
      "executor": "semver:github",
      "options": {
        "tag": "{tag}",
        "title": "Release {version}",
        "notes": "{notes}",
        "prerelease": "{prerelease}"
      }
    }
  }
}
```

```sh
isox reset
isox version workspace --dry-run
isox version workspace
```

All versioned workspace manifests receive the shared version, but only the two
listed packages are published. Both builds finish before either publish starts;
list dependency builds first. Each cross-project post target receives the same
release values. GitHub receives one release with the shared `v` tag and combined
notes, and only the root changelog is written.

These examples leave `skipCommit` at its default `false` so pushed tags contain
the updated manifests. See [Skipping the release commit](#skipping-the-release-commit)
if you prefer to stage generated files without committing them.

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
| `push` | `false` | Atomically push the current branch and new tag before post targets |
| `remote` | `origin` | Configured Git remote used by `push` |
| `postTargets` | `[]` | Ordered target references or objects with `target` and `options` |

A real release requires a clean index and working tree, including untracked files,
full Git history, and tags. Ignored files such as `.isox` do not interfere. Isox
updates package manifests and enabled changelogs, commits them unless
`skipCommit` is set, and creates an annotated tag. An explicit first release can
create an empty release commit if the version is unchanged and changelogs are
disabled. Git hooks remain enabled. Configure Git author identity in CI.

Pushing requires a branch checkout. Isox pushes only that branch and its new tag
atomically, without force pushing or pushing other local tags. The remote must
support atomic pushes. Detached checkouts can create local releases with
`push: false`.

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

Keep the `github` target configured as above and set `push: true` if this target
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
versions to match the latest reachable shared tag. All participants receive the
new version, including packages without their own changes. There is one commit
and one tag for the entire release; the default tag prefix is `v`.

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
`commitMessageFormat` has no effect in this mode. The clean-working-tree
requirement still applies before the release starts.

The updated versions and changelogs remain local staged changes. A pushed tag
therefore references the original source commit, **without** those generated
updates. Post targets run locally after generation, so build/publish targets see
the new manifest versions. Commit the staged files yourself if you want to keep
them in history; a fresh checkout of the tag will still contain the original
manifest versions. Normal version matching will reject that checkout if its
manifest version differs from the release tag.

`commitMessageFormat` otherwise supports `{projectName}` and `{version}` anywhere
in the message, including multiline bodies. The message is passed directly to
Git without shell expansion. These booleans and the message can be overridden
from the CLI, for example `--skip-commit`, `--sync-versions`,
`--skip-project-changelog`, and `--commit-message-format='release: {version}'`.

## Post targets

Targets run sequentially after file generation, the optional commit, tag, and the optional push. A string such
as `build` runs on the released project. `tools:publish` selects another project;
`tools:publish:acc` selects a configuration. Objects can add option overrides:

```json
{
  "postTargets": [
    "build",
    {
      "target": "tools:publish:acc",
      "options": {
        "packageVersion": "{version}"
      }
    },
    "github"
  ]
}
```

Placeholders are resolved recursively in the target's effective options, after
its named/default configuration and post-target overrides are merged:

| Placeholder | Value |
| --- | --- |
| `{projectName}` | Released project name, even for a target on another project |
| `{version}` | New package version |
| `{tag}` | New Git tag |
| `{previousTag}` | Previous release tag, or an empty string for the first release |
| `{preid}` | Final version’s prerelease identifiers without a trailing numeric counter (e.g. `alpha` or `alpha.preview`); empty for stable releases |
| `{npmTag}` | `{preid}` for prereleases, `latest` for stable releases; falls back to `next` if the prerelease identifier is `latest` or parses as a semantic version range |
| `{prerelease}` | Boolean indicating whether the final version is a prerelease |
| `{notes}` | The new changelog section, including its version heading |
| `{dryRun}` | Boolean dry-run flag when used as the entire value |

An entire placeholder retains its type. A placeholder inside other text becomes
a string. Stored project definitions and configurations are not modified.

Placeholders are option substitution, not shell escaping. Pass release notes to
`semver:github` through its `notes` option; do not interpolate commit-derived
notes into a shell command. The GitHub executor writes notes to a temporary file.

The first failed post target stops the sequence. Post targets cannot invoke
another `semver:version`. Continuous/watch targets are unsuitable here: a post
target must finish before the next one runs. No target dependencies are scheduled.

These are release executor `options.postTargets`, distinct from the CLI's general
`--post-targets` stages. Configure them in `project.json`; use `--options` with a
JSON object if you need to override them in a multi-project invocation.

## GitHub executor

Install and authenticate the [GitHub CLI](https://cli.github.com/). In GitHub
Actions, give the job `contents: write` and provide `GH_TOKEN`.

| Option | Required/default | Meaning |
| --- | --- | --- |
| `tag` | Required | Existing remote Git tag |
| `notes` | Required | Release notes, including an empty string |
| `title` | Tag | Release title |
| `repository` | Current repository | GitHub `owner/repo` |
| `draft` | `false` | Create a draft release |
| `prerelease` | `false` | Mark as a prerelease; use `"{prerelease}"` when invoked as a release post target |
| `dryRun` | `false` | Log without invoking GitHub |

The executor calls `gh release create` with `--verify-tag`; it does not let GitHub
create a missing tag on its default branch. Push the tag first, either with
`semver:version`'s `push: true` or as part of your own workflow. Existing GitHub
releases are not overwritten. GitHub CLI errors cause the target to fail.

## CI and multiple projects

Check out the intended branch with full history and tags, install dependencies,
and configure Git author name/email. GitHub Actions needs push credentials when
`push` is enabled and `GH_TOKEN` when creating releases. Then run:

```sh
isox run-many --target=version --parallel=1
```

Use `run-many` for independent releases. For synchronized versions, invoke only
the coordinating target, such as `isox version workspace`.

Only projects with a `version` target are selected by `run-many`; normal tag
filters still apply. Use `--projects` to select a subset. Each independent project
examines commits since its own release tag, so unrelated
commits are skipped. For releases, this also avoids relying on an affected base
that might omit changes since an earlier release.

A repository-wide release lock prevents concurrent Git mutations, including
across linked worktrees. Set `--parallel=1`; a competing release fails with an
explanation rather than racing another process. If a release process is killed,
remove the reported `isox-release.lock` only after confirming it is no longer
running.

## Recovering from failure

A failure before committing can leave the generated release files or index
changes for inspection. Fix the cause and commit/tag the prepared release, or
restore only those generated changes before retrying.

A push or post-target failure keeps the release commit and tag, or the staged
files and tag when using `skipCommit`. Retry the failed
push or target with that existing version; do not generate a new version just to
retry publication. A normal repeat of `version` with no new releasable commits
skips post targets as well. For GitHub recovery, use `gh release create` with the
existing tag and the corresponding changelog section, or call the `github`
target with explicit `--tag` and `--notes` overrides.
