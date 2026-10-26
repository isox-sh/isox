import { randomUUID } from 'node:crypto'
import { chmod, cp, mkdir, readdir, rename, rm, writeFile } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'

import { comparisonPath, digest, inside, noSymlinks, readBoundedFile, snapshot, stableJson, statIfExists } from './files'
import { assertDisposableOutputs } from './safety'

import type { ExecutorContext } from '../executor/types'
import type { FileEntry } from './files'
import type { TerminalChunk } from './output'

interface CachedDirectory {
  path: string
  entries: FileEntry[]
}

interface CacheEntry {
  version: 1
  hash: string
  project: string
  target: string
  createdAt: string
  durationMs: number
  outputs: CachedDirectory[]
  logs: TerminalChunk[]
}

const maxMetadataBytes = 64 * 1024 * 1024

export const taskCacheDirectory = (root: string): string => join(root, '.isox', 'tasks')

export async function prepareCacheDirectory(root: string): Promise<string> {
  const directory = taskCacheDirectory(root)

  await noSymlinks(root, directory)
  await mkdir(directory, { recursive: true })

  return directory
}

/** Output declarations grant exclusive ownership, including removal of stale files. */
export async function clearOutputs(root: string, outputs: string[]): Promise<void> {
  await assertDisposableOutputs(root, outputs)

  for (const path of outputs) {
    await rm(resolve(root, path), {
      recursive: true,
      force: true
    })
  }
}

interface OutputTransaction {
  commit: () => Promise<void>
  rollback: () => Promise<void>
}

/** Move previous outputs aside until a finite execution has finished successfully. */
export async function prepareOutputs(root: string, outputs: string[]): Promise<OutputTransaction> {
  await assertDisposableOutputs(root, outputs)

  if (!outputs.length) {
    return {
      commit: async () => {},
      rollback: async () => {}
    }
  }

  const staging = join(await prepareCacheDirectory(root), `${randomUUID()}.run`)
  const moved: number[] = []
  const prepared: string[] = []

  await mkdir(staging)
  // An abrupt process termination leaves this map alongside the previous files.
  await writeFile(join(staging, 'outputs.json'), JSON.stringify(outputs), { flag: 'wx' })
  const commit = () => rm(staging, {
    recursive: true,
    force: true
  })
  const rollback = async () => {
    try {
      await assertDisposableOutputs(root, prepared)

      for (const output of prepared) {
        await noSymlinks(root, resolve(root, output))
        await rm(resolve(root, output), {
          recursive: true,
          force: true
        })
      }

      for (const index of moved) {
        const destination = resolve(root, outputs[index])

        await noSymlinks(root, destination)
        await mkdir(dirname(destination), { recursive: true })
        await rename(join(staging, String(index)), destination)
      }
    } catch (error) {
      throw new Error(`Could not restore previous task outputs. Remaining backups are in ${staging}; recover them before running isox reset.`, { cause: error })
    }

    await commit()
  }

  try {
    for (const [index, output] of outputs.entries()) {
      const destination = resolve(root, output)

      await noSymlinks(root, destination)

      if (await statIfExists(destination)) {
        await rename(destination, join(staging, String(index)))
        moved.push(index)
      }

      prepared.push(output)
    }
  } catch (error) {
    try {
      await rollback()
    } catch (rollbackError) {
      throw new AggregateError([error, rollbackError], 'Preparing task outputs failed and backups could not be fully restored.', { cause: rollbackError })
    }

    throw error
  }

  return {
    commit,
    rollback
  }
}

/** Publish claims before checking peers so overlapping writers cannot both proceed. */
export async function claimOutputs(root: string, outputs: string[]): Promise<() => Promise<void>> {
  const directory = join(await prepareCacheDirectory(root), 'locks')

  await noSymlinks(root, directory)
  await mkdir(directory, { recursive: true })
  const claimed = await Promise.all(outputs.map(output => comparisonPath(resolve(root, output))))
  const claim = join(directory, `${randomUUID()}.json`)
  const temporary = `${claim}.tmp`

  try {
    await writeFile(temporary, JSON.stringify(claimed), { flag: 'wx' })
    await rename(temporary, claim)
  } finally {
    await rm(temporary, { force: true })
  }

  const release = () => rm(claim, { force: true })

  try {
    for (const file of await readdir(directory)) {
      if (!file.endsWith('.json') || file === claim.slice(directory.length + 1)) {
        continue
      }

      let other: string[]

      try {
        await noSymlinks(root, join(directory, file))
        other = JSON.parse(await readBoundedFile(join(directory, file), maxMetadataBytes))
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
          continue
        }

        throw error
      }

      if (!Array.isArray(other) || other.some(path => typeof path !== 'string')
        || other.some(path => claimed.some(output => inside(path, output) || inside(output, path)))) {
        throw new Error('Another cached task owns overlapping outputs. If no tasks are running, recover any task backups before using isox reset to clear stale locks.')
      }
    }

    return release
  } catch (error) {
    await release()

    throw error
  }
}

async function copyDirectory(source: string, destination: string): Promise<FileEntry[]> {
  const entries = await snapshot(source)

  if (entries.length) {
    if (entries[0].kind !== 'directory') {
      throw new Error(`Task outputs must be directories: ${source}`)
    }

    await cp(source, destination, {
      recursive: true,
      preserveTimestamps: true,
      verbatimSymlinks: true
    })

    // Reject symlinks before chmod can follow one.
    await snapshot(destination)

    // cp applies the current umask. Restore recorded permission bits explicitly.
    for (const entry of [...entries].reverse()) {
      await chmod(join(destination, entry.path), entry.mode)
    }

    if (stableJson(await snapshot(destination)) !== stableJson(entries)) {
      throw new Error(`Task outputs changed while copying: ${source}`)
    }
  }

  return entries
}

/** Validate all artifacts in staging before touching any workspace output. */
export async function restoreTask(context: ExecutorContext, hash: string, outputs: string[], unchanged: () => Promise<boolean> = async () => true): Promise<TerminalChunk[] | undefined> {
  const directory = await prepareCacheDirectory(context.workspaceRoot)
  const source = join(directory, hash)
  const staging = join(directory, `${hash}.${randomUUID()}.restore`)
  let entry: CacheEntry

  try {
    await noSymlinks(context.workspaceRoot, join(source, 'entry.json'))
    await noSymlinks(context.workspaceRoot, join(source, 'entry.sha256'))
    const metadata = await readBoundedFile(join(source, 'entry.json'), maxMetadataBytes)

    if (digest(metadata) !== await readBoundedFile(join(source, 'entry.sha256'), 64)) {
      throw new Error('Invalid task cache metadata checksum')
    }

    entry = JSON.parse(metadata)

    if (entry.version !== 1 || entry.hash !== hash || entry.project !== context.projectName || entry.target !== context.commandName
      || !Array.isArray(entry.outputs) || stableJson(entry.outputs.map(output => output.path)) !== stableJson(outputs)
      || !Array.isArray(entry.logs) || entry.logs.some(chunk => !chunk || !['stdout', 'stderr'].includes(chunk.stream) || typeof chunk.data !== 'string'
        || Buffer.from(chunk.data, 'base64').toString('base64') !== chunk.data)) {
      throw new Error('Invalid task cache metadata')
    }

    await mkdir(staging)
    await writeFile(join(staging, 'outputs.json'), JSON.stringify(outputs), { flag: 'wx' })

    for (const [index, output] of entry.outputs.entries()) {
      const artifact = join(source, String(index))

      await noSymlinks(context.workspaceRoot, artifact)
      const entries = await copyDirectory(artifact, join(staging, String(index)))

      if (stableJson(entries) !== stableJson(output.entries)) {
        throw new Error('Invalid task cache artifact')
      }
    }
  } catch (error) {
    await rm(staging, {
      recursive: true,
      force: true
    })

    if ((error as NodeJS.ErrnoException).code !== 'ENOENT' || await statIfExists(source)) {
      context.logger.warn(`Ignoring incomplete or corrupt task cache entry ${hash}: ${error instanceof Error ? error.message : String(error)}`)
      // Preserve atomic publication: move the corrupt entry away, never modify it in place.
      const invalid = join(directory, `${hash}.${randomUUID()}.invalid`)

      try {
        await rename(source, invalid)
        await rm(invalid, {
          recursive: true,
          force: true
        })
      } catch (moveError) {
        if ((moveError as NodeJS.ErrnoException).code !== 'ENOENT') {
          throw moveError
        }
      }
    }

    return undefined
  }

  const moved: number[] = []
  const restored: number[] = []
  let cleanup = true

  try {
    if (!await unchanged()) {
      return undefined
    }

    context.signal?.throwIfAborted()
    await assertDisposableOutputs(context.workspaceRoot, outputs)

    for (const [index, output] of outputs.entries()) {
      context.signal?.throwIfAborted()
      const destination = resolve(context.workspaceRoot, output)

      await noSymlinks(context.workspaceRoot, destination)
      await mkdir(dirname(destination), { recursive: true })

      if (await statIfExists(destination)) {
        await rename(destination, join(staging, `${index}.previous`))
        moved.push(index)
      }

      if (entry.outputs[index].entries.length) {
        await rename(join(staging, String(index)), destination)
        restored.push(index)
      }
    }

    context.signal?.throwIfAborted()

    return entry.logs
  } catch (error) {
    // Keep backups if rollback itself fails; never delete the last good copy.
    try {
      await assertDisposableOutputs(context.workspaceRoot, restored.map(index => outputs[index]))

      for (const index of restored.reverse()) {
        await rm(resolve(context.workspaceRoot, outputs[index]), {
          recursive: true,
          force: true
        })
      }

      for (const index of moved.reverse()) {
        const destination = resolve(context.workspaceRoot, outputs[index])

        await noSymlinks(context.workspaceRoot, destination)
        await rename(join(staging, `${index}.previous`), destination)
      }
    } catch (rollbackError) {
      cleanup = false

      throw new AggregateError([error, rollbackError], `Task output restoration failed. Previous outputs are retained in ${staging}.`, { cause: rollbackError })
    }

    throw error
  } finally {
    if (cleanup) {
      await rm(staging, {
        recursive: true,
        force: true
      })
    }
  }
}

export async function storeTask(context: ExecutorContext, hash: string, outputs: string[], logs: TerminalChunk[], durationMs: number, unchanged: () => Promise<boolean>): Promise<void> {
  const directory = await prepareCacheDirectory(context.workspaceRoot)
  const staging = join(directory, `${hash}.${randomUUID()}.tmp`)

  await mkdir(staging)

  try {
    const artifacts: CachedDirectory[] = []

    for (const [index, output] of outputs.entries()) {
      const source = resolve(context.workspaceRoot, output)

      await noSymlinks(context.workspaceRoot, source)
      artifacts.push({
        path: output,
        entries: await copyDirectory(source, join(staging, String(index)))
      })
    }

    if (context.signal?.aborted || !await unchanged() || context.signal?.aborted) {
      context.logger.debug('Task inputs changed during execution; result was not cached.')

      return
    }

    const entry: CacheEntry = {
      version: 1,
      hash,
      project: context.projectName,
      target: context.commandName,
      createdAt: new Date().toISOString(),
      durationMs,
      outputs: artifacts,
      logs,
    }

    const metadata = `${JSON.stringify(entry)}\n`

    if (Buffer.byteLength(metadata) > maxMetadataBytes) {
      context.logger.debug('Task metadata exceeded 64 MiB; result was not cached.')

      return
    }

    await writeFile(join(staging, 'entry.json'), metadata, { flag: 'wx' })
    await writeFile(join(staging, 'entry.sha256'), digest(metadata), { flag: 'wx' })

    if (context.signal?.aborted) {
      return
    }

    try {
      await rename(staging, join(directory, hash))
    } catch (error) {
      if (!['EEXIST', 'ENOTEMPTY'].includes((error as NodeJS.ErrnoException).code ?? '')) {
        throw error
      }
      // Another successful writer already published the complete key.
    }

    context.logger.debug(`Stored task result ${hash}`)
  } finally {
    await rm(staging, {
      recursive: true,
      force: true
    })
  }
}
