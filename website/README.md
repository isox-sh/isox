# Isox website and documentation

Isox discovers projects and runs commands defined in their `project.json` files.
Start with the setup guide, then use the topic references for your workspace.

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

## Preview and validate

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

## Editing pages

Keep guides in `website/docs/`. The contributing guide uses `.mdx` because
Mintlify excludes `contributing.md`. New
pages can use MDX for Mintlify components such as cards and callouts. Give each
page a frontmatter title and description, and list its extensionless path in
`docs.json`, for example `docs/getting-started`. Within site content, use links
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

## Hosting

Connect this repository in Mintlify and set its documentation path to `/website`
(the directory containing `docs.json`, not the nested `website/docs/` directory).
The directory contains the homepage, complete site configuration, and documentation.
Select the deployment branch and domain in the Mintlify dashboard. To serve the
whole site from `isox.sh`, connect that domain to this Mintlify deployment when
switching hosting. See Mintlify's
[monorepo setup](https://www.mintlify.com/docs/deploy/monorepo) for the hosting settings.

## Guides and reference

- [Getting started](docs/getting-started.md) — requirements, installation, and your first project.
- [Core concepts](docs/concepts.mdx) — projects, executors, configurations, dependencies, and caching.
- [CLI reference](docs/cli.md) — commands, named configurations, and current scope.
- [Affected projects and GitHub Actions](docs/affected-and-ci.md) — Git selection, weighted plans, tag filters, and CI workers.
- [Workspace and project configuration](docs/configuration.md) — workspace roots, schemas, project definitions, and on-demand dependency caching.
- [Shell commands](docs/shell-commands.mdx) — run existing tools and package scripts with the built-in executor.
- [TypeScript executor](docs/typescript.md) — project initialization, compiler options, assets, package generation, and watch mode.
- [ESLint executor](docs/eslint.md) — project linting, fixes, and warning limits.
- [Vitest executor](docs/vitest.md) — test commands and configuration.
- [Releases](docs/semver.md) — conventional commits, prereleases, synchronized versions, and publishing hooks.
- [Core API](docs/core-api.md) — programmatic execution, schemas, JSON helpers, and logging.
- [Custom executors and initializers](docs/custom-executors.md) — plugin manifests, context, results, and cancellation.
- [Plugin end-to-end testing](docs/plugin-testing.md) — reusable test workspaces with configurable local plugins.
- [Troubleshooting](docs/troubleshooting.mdx) — discovery, configuration, build, and CI selection problems.
- [Migrating from Nx](docs/nx-migration.md) — project conversion and temporary Nx 23 adapter support.
- [AI migration prompt](docs/prompts/migrate-nx-to-isox.md) — a reusable prompt for migrating an existing Nx workspace.

## Project development

- [Contributing](docs/contributing.mdx) — local setup, builds, tests, and CI.
- [Roadmap](../ROADMAP.md) — capability boundaries, planned work, and validation records.

[Project overview](../README.md)
