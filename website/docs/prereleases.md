---
title: "Prereleases"
description: "Publish alpha, beta, and release candidate versions."
icon: "flask"
---

Use a prerelease identifier to ship preview versions. The examples below cover version progression and a complete build, npm publish, and GitHub release flow.

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
the updated manifests. See [Skipping the release commit](/docs/release-options#skipping-the-release-commit)
if you prefer to stage generated files without committing them.

[Back to releases](/docs/semver).
