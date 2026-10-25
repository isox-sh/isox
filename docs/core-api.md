# Reading and writing project JSON

Use `json(value)` to format a value as JSON text without writing a file:

```typescript
import { json } from '@isox-sh/core'

const source = json({ enabled: true })
```

It returns two-space-indented JSON with a trailing newline. Values that cannot
produce a JSON document, such as `undefined`, bigint, and circular objects, throw
a `TypeError`. `writeJson` uses the same serializer, and tests can reuse it for
fixtures or expected command output.

Use `writeJson` from an executor or initializer to write JSON within its project:

```typescript
import { writeJson } from '@isox-sh/core'

await writeJson('config/settings.json', { enabled: true }, context)
```

The project root must exist. Paths resolve from `context.projectRoot`; parent
directories inside the project are created as needed. Paths outside the project
and symlinks inside it are rejected. Writes are atomic, with two-space indentation
and a trailing newline. Pass `{ overwrite: false }` as the fourth argument when
existing files must be preserved.

After a successful write, the logger reports `Created file <path>` or
`Updated file <path>`. The path is workspace-relative, or project-relative when
`workspaceRoot` is omitted. The utility uses
`context.logger` when provided, otherwise core's default logger.

Read project JSON with the same path restrictions:

```typescript
import { readJson } from '@isox-sh/core'

const settings = await readJson<{ enabled: boolean }>('config/settings.json', context)
```

`readJson` accepts UTF-8 JSON, including a leading byte order mark, and does not
log reads. Missing files retain their filesystem error codes; malformed JSON
throws a `SyntaxError` naming the file and preserving the original error as its
cause. Results default to `unknown`; a supplied TypeScript type does not perform
runtime validation.

Add dependencies to the project's `package.json` with `addDepsToPackageJson`:

```typescript
import { addDepsToPackageJson } from '@isox-sh/core'

await addDepsToPackageJson({
  dependencies: { example: '^1.0.0' },
  devDependencies: { '@isox-sh/nx': '0.0.1' },
}, context)
```

The helper creates a missing manifest, preserves other package metadata, and
keeps existing versions and dependency sections. It sorts sections it changes
and uses `readJson` and `writeJson` for project containment and file-action logging.
Repeated additions leave the file untouched. Run the workspace's package manager
afterward to install dependencies and update its lockfile.

