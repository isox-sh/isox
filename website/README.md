# Isox documentation

Install `@isox-sh/cli` to get the `isox` command. Start with the
[getting started guide](docs/getting-started.md), then choose a topic below.

The site has three top tabs: **Guides** for everyday workflows, **Plugins** for
extending Isox, and **Reference** for CLI/configuration details and contributing.

## Learn the basics

- [Introduction](docs/introduction.mdx) — what Isox does and where it fits.
- [Getting started](docs/getting-started.md) — install the CLI and run your first command.
- [Core concepts](docs/concepts.mdx) — projects, targets, executors, and dependencies.
- [CLI reference](docs/cli.md) — commands, flags, and configurations.
- [Workspace configuration](docs/configuration.md) — project definitions, defaults, and discovery.

## Build, test, and release

- [Shell commands](docs/shell-commands.mdx) — run existing tools and package scripts.
- [TypeScript](docs/typescript.md) — scaffold and build packages.
- [ESLint](docs/eslint.md) and [Vitest](docs/vitest.md) — lint and test projects.
- [Task caching](docs/task-caching.md) — reuse successful task results.
- [Affected projects and CI](docs/affected-and-ci.md) — select changes and distribute work.
- [Releases](docs/semver.md) — version packages, write changelogs, and publish.

## Plugins

- [Build Isox plugins](docs/custom-plugins.md) — choose the features your plugin provides.
- [Your first plugin](docs/plugin-quickstart.md) — create, install, and run a working executor.
- [Layout and packaging](docs/plugin-packaging.md) — organize and publish plugin files.
- [Executors](docs/custom-executors.md) — run targets with cancellation and caching.
- [Generators](docs/plugin-generators.md) — create projects and add plugin configuration.
- [Migrations](docs/plugin-migrations.md) — publish versioned configuration updates.
- [Plugin testing](docs/plugin-testing.md) — test plugins in temporary workspaces.
- [Core API](docs/core-api.md) — programmatic execution, types, and helpers.

## Update and migrate

- [Updating Isox](docs/migrations.md) — plan upgrades and run migration scripts.
- [Nx migration](docs/nx-migration.md) and [AI migration prompt](docs/prompts/migrate-nx-to-isox.md).

## Get help and contribute

- [Troubleshooting](docs/troubleshooting.mdx) — diagnose common errors.
- [Contributing](docs/contributing.mdx) — development setup, builds, tests, and releases.
- [Roadmap](../ROADMAP.md) — planned work and current limits.

## Maintain this site

This directory is a [Mintlify](https://www.mintlify.com/docs) site containing both
the product homepage and documentation. [index.mdx](index.mdx) serves the homepage
at `/`; [docs/introduction.mdx](docs/introduction.mdx) starts the documentation at
`/docs/introduction`. [docs.json](docs.json) defines navigation and branding.

```text
website/
├── docs.json         # Mintlify configuration
├── project.json      # Isox serve and test commands
├── index.mdx         # Homepage at /
├── custom.css        # Homepage styles
├── images/           # Shared brand assets
└── docs/             # Guides at /docs/...
    ├── introduction.mdx
    ├── getting-started.md
    └── prompts/
```

### Preview and validate

From the repository root, using Node.js 24 or 26+ and the repository's pnpm
version, run `pnpm install` and `pnpm bootstrap` once to prepare the local CLI.
Then use the website project's commands:

```sh
pnpm isox serve website
pnpm isox test website
```

The preview normally opens at `http://localhost:3000`. The `test` command validates
the build and internal links, including heading anchors. Both commands are
defined in `project.json` and download Mintlify's tooling on first use. Validation
uses a pinned CLI version.

### Editing pages

Keep guides in `website/docs/`. The contributing guide uses `.mdx` because
Mintlify excludes `contributing.md`. New
pages can use MDX for Mintlify components such as cards and callouts. Give each
page a frontmatter title and description, and list its extensionless path in
the appropriate tab and group in `docs.json`, for example `docs/getting-started`.
Keep each guide focused on one task: lead with a working example, put option
details in tables, and link to separate pages for advanced behavior. Preserve
existing URLs and heading links when moving material. Within site content, use links
such as `/docs/cli#named-configurations`. Link to source files outside `website/`
using their full GitHub URL. Redirects preserve the previous guide URLs.

`README.md` is a repository index and is excluded from the published site by
Mintlify. The homepage uses `mode: custom` for a full-width landing page, with
styles in `custom.css` scoped to `.isox-home`. Documentation pages use Mintlify's
standard layout. Brand assets in `images/` reuse the Isox cube mark with light
and dark wordmarks. Edit `index.mdx` for the homepage and `docs/` for the guides.

The existing Isox CI plan picks up the website's `test` target automatically.
Website changes select this project, and the shared CI worker runs its Mintlify
build and link checks. Mintlify builds and hosts the site from its source files.

### Hosting

Connect this repository in Mintlify and set its documentation path to `/website`
(the directory containing `docs.json`, not the nested `website/docs/` directory).
The directory contains the homepage, complete site configuration, and documentation.
Select the deployment branch and domain in the Mintlify dashboard. To serve the
whole site from `isox.sh`, connect that domain to this Mintlify deployment when
switching hosting. See Mintlify's
[monorepo setup](https://www.mintlify.com/docs/deploy/monorepo) for the hosting settings.

[Project overview](../README.md)
