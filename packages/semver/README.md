# @isox-sh/semver

Conventional commit versioning and changelogs for Isox projects.

```sh
pnpm add -D @isox-sh/semver
isox add @isox-sh/semver my-package
isox version my-package --dry-run
```

`add` selects an existing project by name and configures its `version` target.
Existing targets, custom fields, and customized release options are preserved; a conflicting `version` target is rejected.

For alpha publishing to npm and GitHub, extend the generated target in
`project.json`. This example keeps your existing `build` target:

```json
{
  "targets": {
    "version": {
      "executor": "semver:version",
      "options": {
        "preid": "alpha",
        "push": true,
        "postTargets": ["build", "publish", "github"]
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
        "notes": "{notes}",
        "prerelease": "{prerelease}"
      }
    }
  }
}
```

`build` must generate the package into `dist/my-package` with the updated manifest
version; adjust the publish path to your output. Authenticate npm and `gh` first.
This target commits and pushes the release, then builds, publishes to npm under
`alpha`, and creates a GitHub prerelease.

```sh
isox reset
isox version my-package --dry-run
isox version my-package

# Promote a pending 1.0.0 prerelease to stable; npm uses latest.
isox version my-package --release-as=1.0.0
```

Exact `releaseAs` versions override `preid`. Remove the configured `preid` and
refresh discovery when subsequent releases should also be stable. See the
[complete publishing examples](https://isox.sh/docs/semver#publish-an-alpha-package-and-create-a-github-release)
for a build target and a workspace release that publishes multiple projects.

`semver:version` looks at commits touching the project since its highest
reachable version tag, updates `package.json` and `CHANGELOG.md`, commits those
files by default, and creates an annotated tag such as `my-package@1.2.0`. Pushing is opt-in.
Commit parsing, bump recommendations, and notes use the
[Conventional Changelog Conventional Commits preset](https://github.com/conventional-changelog/conventional-changelog/tree/master/packages/conventional-changelog-conventionalcommits).
Breaking changes bump major, `feat`/`feature` bump minor, and `fix`/`perf`/`revert` bump patch.
Other commits do not trigger a release unless they contain a breaking change.
Commit/revert pairs within the selected history cancel each other out.
A dry run writes nothing and skips all post targets.

Use `--parallel=1` when releasing multiple projects. Releases require a clean
working tree, complete Git history, and tags. Versions are independent by default.
Set `syncVersions: true` on one coordinating target to update all versioned
workspace packages together, using one shared `v` tag and a root changelog.
Dependency ranges and lockfiles are not updated automatically.

For alpha versions, set `preid: "alpha"` in the version options or run:

```sh
isox version my-package --preid=alpha --dry-run
```

A calculated `1.0.0` starts at `1.0.0-alpha.0`; subsequent releasable changes
increment the counter unless a higher base version is needed. An exact
`--release-as=1.0.0` takes precedence and can promote the release to stable.
Post targets can use `{preid}` for the prerelease identifier, `{npmTag}` for
`alpha`/`beta`/`latest` publication tags, and `{prerelease}` for the GitHub
prerelease boolean. For example: `npm publish ./dist/my-package --tag {npmTag}`.
These values reflect the final version, so stable promotion selects `latest`.

Additional options:

- `skipCommit`: stage generated files and tag the existing `HEAD`; pushing and
  post targets still run. The generated changes remain uncommitted locally.
- `skipProjectChangelog`: leave project changelogs untouched; synchronized
  releases still update the root changelog. Post targets still receive notes.
- `commitMessageFormat`: customize the message using `{projectName}` and
  `{version}` (default: `chore({projectName}): Release {version}`).

See the [release documentation](https://isox.sh/docs/semver) for options,
post-target placeholders, CI setup, and recovery after a failed post target.
