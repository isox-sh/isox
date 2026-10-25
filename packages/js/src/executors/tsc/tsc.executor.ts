import { chmod, mkdir, open, readFile, rm, stat } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'

import fg from 'fast-glob'

import { generatePackageJson } from '../../helpers/package-json'
import { collectAssets } from './assets'
import { withBuildConfig } from './build-config'
import { compile, readConfig } from './compiler'
import {
  atomicWrite,
  canonical,
  checkOwners,
  existingFile,
  hash,
  inside,
  loadState,
  outputRoots,
  removeOwned,
  safeDestination,
  statePath,
} from './files'
import { validateOptions } from './options'
import { watchBuilds } from './watch'

import type { OutputState } from './files'
import type { TscOptions } from './options'
import type { ExecutorContext, ExecutorOutput, ExecutorResult } from '@isox-sh/core'

export type { AssetPattern, TscOptions } from './options'

async function build(options: TscOptions, context: ExecutorContext, tsConfig: string, signal?: AbortSignal): Promise<ExecutorResult> {
  const parsed = await readConfig(tsConfig, context.workspaceRoot, signal)

  if (!parsed.config) {
    if (!signal?.aborted) {
      context.logger.error(parsed.output.trim())
    }

    return { success: false }
  }

  if (signal?.aborted) {
    return { success: false }
  }

  const config = parsed.config
  const roots = config.compilerOptions.noEmit ? [] : await outputRoots(config, tsConfig, context)
  const stateFile = statePath(context)

  if (await canonical(dirname(stateFile)) !== dirname(stateFile)) {
    throw new Error('Symlink in TypeScript output-state directory.')
  }

  await mkdir(dirname(stateFile), { recursive: true })
  let lock

  try {
    lock = await open(`${stateFile}.lock`, 'wx')
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'EEXIST') {
      throw new Error('Another TypeScript build is using this project. Stop it before building again.', { cause: error })
    }

    throw error
  }

  try {
    // Publish before checking peers so concurrent first builds cannot both claim an output.
    const claim: OutputState = {
      version: 1,
      project: context.projectRoot,
      config: tsConfig,
      roots,
      files: {}
    }

    await atomicWrite(`${stateFile}.claim`, JSON.stringify(claim))
    await checkOwners(stateFile, roots, context)
    const previous = await loadState(stateFile)

    for (const file of Object.keys(previous?.files ?? {})) {
      if (roots.some(root => inside(root, file))) {
        await safeDestination(file, roots)
      }
    }

    // Validate existing output paths before the compiler can follow a symlink.
    for (const root of roots) {
      for (const file of await fg('**/*', {
        cwd: root,
        absolute: true,
        dot: true,
        followSymbolicLinks: false,
        onlyFiles: false
      })) {
        await safeDestination(file, roots)
      }
    }

    if (config.compilerOptions.noEmit && (options.generatePackageJson || options.assets?.length)) {
      throw new Error('Package generation and assets require an emitting tsconfig.')
    }

    const outDir = config.compilerOptions.outDir ? resolve(dirname(tsConfig), config.compilerOptions.outDir) : undefined
    const assets = outDir ? await collectAssets(options, context, outDir, roots) : new Map<string, Buffer>()
    const compilation = await withBuildConfig(tsConfig, context, stateFile, buildConfig =>
      compile(buildConfig, context.workspaceRoot, stateFile, config, signal),
    )

    if (!compilation.success || signal?.aborted) {
      return { success: false }
    }

    if (config.compilerOptions.noEmit) {
      return { success: true }
    }

    const emitted = new Set(compilation.emitted.filter(file => roots.some(root => inside(root, file))))

    for (const file of emitted) {
      await safeDestination(file, roots)
    }

    // The compiler has already published these files. Record them before packaging
    // so a failed metadata build cannot strand output that later builds cannot clean.
    const pendingFiles = { ...previous?.files }

    for (const file of emitted) {
      pendingFiles[file] = hash(await readFile(file))
    }

    await atomicWrite(stateFile, JSON.stringify({
      ...claim,
      roots: [...new Set([...(previous?.roots ?? []), ...roots])],
      files: pendingFiles,
    }))

    const declarationDir = config.compilerOptions.declarationDir
      ? resolve(dirname(tsConfig), config.compilerOptions.declarationDir)
      : undefined
    const generated = options.generatePackageJson && outDir
      ? await generatePackageJson({
        ...options,
        tsConfig,
        sourceFiles: config.files?.map(file => resolve(dirname(tsConfig), file)),
      }, context, outDir, emitted, assets, declarationDir)
      : new Map<string, Buffer>()
    const additions = new Map(assets)

    for (const [file, content] of generated) {
      if (additions.has(file)) {
        throw new Error(`Generated package file collides with an asset: ${file}`)
      }

      additions.set(file, content)
    }

    for (const [file, content] of additions) {
      await safeDestination(file, roots)

      if (emitted.has(file)) {
        throw new Error(`Asset or package file collides with compiler output: ${file}`)
      }

      if (await existingFile(file) && !previous?.files[file] && hash(await readFile(file)) !== hash(content)) {
        throw new Error(`Refusing to overwrite an unowned output file: ${file}`)
      }
    }

    const keep = new Set([...emitted, ...additions.keys()])

    if (options.clean !== false) {
      await removeOwned(previous, keep, roots)
    }

    // Publish metadata last, after all referenced generated files are ready.
    const manifestPath = outDir ? resolve(outDir, 'package.json') : undefined

    for (const [file, content] of additions) {
      if (file !== manifestPath) {
        await atomicWrite(file, content)
      }
    }

    if (manifestPath && additions.has(manifestPath)) {
      await atomicWrite(manifestPath, additions.get(manifestPath)!)
    }

    // A shebang survives compilation, but the compiler does not set executable permissions.
    const files: Record<string, string> = {}

    for (const file of keep) {
      const content = await readFile(file)

      if (/\.(?:c|m)?js$/.test(file) && content.subarray(0, 2).toString() === '#!') {
        await chmod(file, (await stat(file)).mode | 0o111)
      }

      files[file] = hash(content)
    }

    if (options.clean === false) {
      for (const [file, digest] of Object.entries(previous?.files ?? {})) {
        if (!(file in files)) {
          files[file] = digest
        }
      }
    }

    const state: OutputState = {
      version: 1,
      project: context.projectRoot,
      config: tsConfig,
      roots,
      files
    }

    await atomicWrite(stateFile, `${JSON.stringify(state, null, 2)}\n`)

    return { success: true }
  } finally {
    try {
      await rm(`${stateFile}.claim`, { force: true })
    } finally {
      await lock.close()
      await rm(`${stateFile}.lock`, { force: true })
    }
  }
}

export default async function tsc(options: TscOptions, originalContext: ExecutorContext): Promise<ExecutorOutput> {
  validateOptions(options)
  const context = {
    ...originalContext,
    workspaceRoot: await canonical(originalContext.workspaceRoot),
    projectRoot: await canonical(originalContext.projectRoot),
  }

  const tsConfig = await canonical(options.tsConfig === undefined
    ? resolve(context.projectRoot, 'tsconfig.json')
    : resolve(context.workspaceRoot, options.tsConfig))

  if (options.watch) {
    return watchBuilds(tsConfig, options, context, signal => build(options, context, tsConfig, signal))
  }

  return build(options, context, tsConfig, context.signal)
}
