---
title: "Repository releases"
description: "Release Isox packages and configure npm trusted publishing."
icon: "tag"
---

This page is for maintainers releasing Isox itself. To release packages in your own workspace, start with [releases](/docs/semver).

## Release this repository

In GitHub Actions, open **Release**, select **Run workflow**, and choose the
branch and release channel (`alpha`, `beta`, or `stable`). **Dry run** is enabled by default:
it previews the next synchronized version, changelog, and tag
without changing files or publishing a release.

A real run uses `workspace:version:production` with `skipCommit: true` and `push: false`,
then rebuilds and publishes all public packages to npm. Only after publication
succeeds does it push the exact new tag and create the GitHub release. The tag
points to the existing source commit; the workflow does not push the branch.
`alpha` and `beta` add a prerelease identifier and mark the GitHub release as a
prerelease. `stable` omits the identifier and creates a regular GitHub release.
Generated package versions and the root changelog stay in the runner's checkout;
the branch and tagged source keep their original files. Later releases use the
latest reachable release tag as their version baseline. Bumps come from conventional commits;
without releasable changes, the run succeeds without creating a release.

All channels share one synchronized version history. Release runs are serialized
across branches and channels. The workflow uses `GITHUB_TOKEN` with
`contents: write`; repository rules must permit it to create release tags.
The production configuration runs three ordered post targets:

1. `workspace:npm` rebuilds packages, checks all tarballs, and publishes to npm.
2. `workspace:push-tag` pushes only the new release tag to `origin`.
3. `workspace:github` creates the GitHub release with the new release notes.

Versioning passes `{version}`, `{npmTag}`, `{tag}`, `{notes}`, and `{prerelease}`
to these targets. Dry runs and runs without releasable changes skip all post
targets automatically. A failed target stops the remaining targets.

`scripts/release.mjs` rebuilds and publishes from `dist` with dependencies first. Private
packages are skipped. Alpha and beta versions use the matching npm dist-tag;
stable releases use `latest`. A failed check prevents any publication; a failure
during publication stops the remaining packages, tag push, and GitHub release.
Any packages already published remain on npm. If tag pushing or GitHub release
creation fails afterward, retry that failed step rather than publishing again.

### npm trusted publishing setup

The workflow uses npm's [trusted publishing](https://docs.npmjs.com/trusted-publishers/)
with GitHub OIDC, `id-token: write`, and the current npm CLI (minimum 11.5.1).
It runs on a GitHub-hosted runner with dependency caching disabled. No `NPM_TOKEN`
or `NODE_AUTH_TOKEN` secret is needed for publishing. Public packages include
provenance linking them to this workflow and repository.

For **each** package, open its npm settings and add a GitHub trusted publisher:

| Setting | Value |
| --- | --- |
| Organization or user | `isox-sh` |
| Repository | `isox` |
| Workflow filename | `release.yml` |
| Environment | Leave empty; this workflow does not select an environment |
| Allowed action | Allow direct `npm publish` |

Configure this for every published `@isox-sh/*` package, including `@isox-sh/cli`. Package creation
and the npm-side trusted-publisher settings must be completed before the workflow
can publish them. Repository metadata in the published packages must match this
repository. A local dry run checks the current package versions and tarballs:

```sh
node scripts/release.mjs --tag=latest --dry-run
```

Use `--tag=alpha` or `--tag=beta` when the manifests contain those prerelease
versions. Optional `--version=<version>` requires every package to match the
expected release version. The workflow's dry run previews versioning only and
does not publish or push; the script's dry run rebuilds and checks tarballs
without publishing. Actual publication requires GitHub OIDC. Anyone with write
access to the repository can trigger the manual workflow, including stable
releases; there is no separate username allowlist.

The workflow must exist on the default branch before GitHub shows **Run workflow**.
See [release configuration](/docs/semver) for version calculation and post targets.

[Back to contributing](/docs/contributing).
