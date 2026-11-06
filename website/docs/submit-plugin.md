---
title: "Submit a plugin"
description: "Add your published Isox plugin to the Plugin Registry."
icon: "circle-plus"
---

The [Plugin Registry](/docs/plugin-registry) is maintained in
[`website/approved-community-plugins.json`](https://github.com/isox-sh/isox/blob/main/website/approved-community-plugins.json).
Official and community packages use the same list.

## Before submitting

- Publish your package on npm with a public source repository and a license.
- Document installation, supported Isox and Node.js versions, and a working example.
- [Test your plugin](/docs/plugin-testing) in a real Isox workspace.
- Keep the package description focused on what it does for users.

## Add an entry

Fork [isox-sh/isox](https://github.com/isox-sh/isox), then append an object to the
JSON array:

```json
{
  "name": "@your-org/isox-example",
  "description": "Build Example projects with a native Isox executor.",
  "url": "https://github.com/your-org/isox-example",
  "docs": "https://github.com/your-org/isox-example#readme",
  "category": "Build",
  "official": false
}
```

| Field | What to provide |
| --- | --- |
| `name` | The exact npm package name. Each name may appear only once. |
| `description` | A short explanation of what the package provides. |
| `url` | The HTTPS URL of its public source repository. |
| `docs` | Optional HTTPS documentation URL. Isox packages can use a `/docs/` path. |
| `category` | Prefer an existing category: Build, Lint, Test, Release, Migration, Task execution, or Plugin development. |
| `official` | `false` for community packages. `true` is reserved for packages maintained by the Isox team. |

## Open a pull request

From the repository root, regenerate the directory data:

```sh
node website/scripts/generate-plugin-registry.mjs
```

Include both the JSON change and the generated
`website/snippets/plugin-registry-data.mdx` in your pull request. Explain how to
try your plugin and which Isox versions you tested. Maintainers review submissions
before adding them to the directory.

See the [site contribution instructions](/docs/contributing#documentation) for
local preview and validation commands.
