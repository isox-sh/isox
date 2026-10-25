const { lstatSync, mkdirSync, readlinkSync, rmSync, symlinkSync } = require('node:fs')
const { readFile, realpath } = require('node:fs/promises')
const { dirname, resolve } = require('node:path')

function linkDependency(destination, target) {
  const existing = lstatSync(destination, { throwIfNoEntry: false })

  if (existing) {
    if (!existing.isSymbolicLink()) {
      throw new Error(`Expected a dependency symlink at ${destination}.`)
    }

    if (resolve(dirname(destination), readlinkSync(destination)) === target) {
      return
    }

    // lstat also finds broken links left behind by a dependency upgrade.
    rmSync(destination)
  }

  mkdirSync(dirname(destination), { recursive: true })
  symlinkSync(target, destination, 'junction')
}

async function recordSeedOwnership(root, seededFiles) {
  // These helpers are available after the initial core/JS compilation.
  const { atomicWrite, hash, loadState } = require('../dist/js/executors/tsc/files')

  for (const directory of ['.isox', '.isox/tsc']) {
    const entry = lstatSync(resolve(root, directory), { throwIfNoEntry: false })

    if (entry && (entry.isSymbolicLink() || !entry.isDirectory())) {
      throw new Error(`Unsafe TypeScript output-state directory: ${directory}`)
    }
  }

  for (const [name, files] of seededFiles) {
    const project = await realpath(resolve(root, 'packages', name))
    const path = resolve(root, '.isox/tsc', `${hash(project)}.json`)
    const previous = await loadState(path)
    const digests = { ...previous?.files }

    for (const file of files) {
      digests[file] = hash(await readFile(file))
    }

    // Keep earlier ownership so the build can remove outputs from deleted sources.
    const state = {
      version: 1,
      project,
      config: resolve(project, 'tsconfig.build.json'),
      roots: [resolve(root, 'dist', name)],
      files: digests,
    }

    await atomicWrite(path, `${JSON.stringify(state, null, 2)}\n`)
  }
}

module.exports = {
  linkDependency,
  recordSeedOwnership
}
