---
title: "Publish releases"
description: "Chain release targets, create GitHub releases, and recover failed publishing."
icon: "upload"
---

Use post targets to build and publish after versioning. Define every referenced target on the project; preview the release with `--dry-run` before enabling writes.

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

[Back to releases](/docs/semver).
