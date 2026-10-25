import { readFile } from 'node:fs/promises'
import { dirname, relative, resolve } from 'node:path'

import { json } from '@isox-sh/core'
import fg from 'fast-glob'

import { canonical, existingFile, inside, slash } from './files'
import { inferDependencies, workspaceDependencies } from './package-dependencies'
import { defaultManifest, optionalManifest, readManifest, versionPattern } from './package-manifest'

import type { Json } from './package-manifest'
import type { ExecutorContext } from '@isox-sh/core'

export interface PackageJsonOptions {
  /** Config path relative to the workspace root, or absolute. */
  tsConfig?: string
  /** Absolute paths of the sources included in the compilation. */
  sourceFiles?: string[]
  generateExportsField?: boolean
  additionalEntryPoints?: Record<string, string | Record<string, string>>
}

export type PackageJsonContext = Pick<ExecutorContext, 'workspaceRoot' | 'projectRoot' | 'workspace'>

/** Assemble everything in memory before publishing any generated package metadata. */
export async function generatePackageJson(
  options: PackageJsonOptions,
  context: PackageJsonContext,
  outDir: string,
  emitted: Set<string>,
  assets: Map<string, Buffer>,
  declarationDir?: string,
): Promise<Map<string, Buffer>> {
  const sourcePath = resolve(context.projectRoot, 'package.json')
  const root = await optionalManifest(resolve(context.workspaceRoot, 'package.json')) ?? {}
  const manifest = await optionalManifest(sourcePath) ?? defaultManifest(context.projectRoot, context, root)
  if (typeof manifest.name !== 'string' || !manifest.name.trim() || typeof manifest.version !== 'string' || !versionPattern.test(manifest.version)) {
    throw new Error('Package generation requires a nonempty package name and a valid version.')
  }
  // Reserve package.json so self-referencing exports can be validated before serialization.
  const extra = new Map<string, Buffer>([[resolve(outDir, 'package.json'), Buffer.alloc(0)]])
  for (const file of emitted) {
    if (inside(outDir, file)) {
      continue
    }

    if (!declarationDir || !inside(declarationDir, file)) {
      throw new Error(`Cannot package output outside outDir: ${file}`)
    }

    const target = resolve(outDir, 'types', relative(declarationDir, file))
    let data = await readFile(file)
    if (file.endsWith('.map')) {
      const map = JSON.parse(data.toString())
      if (Array.isArray(map.sources) && !/^[a-z]+:/i.test(map.sourceRoot ?? '')) {
        map.sources = map.sources.map((source: string) => {
          const originalSource = resolve(dirname(file), map.sourceRoot ?? '', source)
          return slash(relative(dirname(target), originalSource))
        })
        map.sourceRoot = ''
        data = Buffer.from(JSON.stringify(map))
      }
    }
    extra.set(target, data)
  }

  // Include only files produced by this build, rather than stale files already on disk.
  const available = () => new Set([
    ...[...emitted].filter(file => inside(outDir, file)),
    ...assets.keys(),
    ...extra.keys(),
  ])
  const targetFor = (path: string, base = context.projectRoot): string => {
    const absolute = resolve(base, path)
    if (inside(outDir, absolute)) {
      return absolute
    }

    // Map the whole declaration directory so wildcard exports follow copied types too.
    if (declarationDir && inside(declarationDir, absolute)) {
      return resolve(outDir, 'types', relative(declarationDir, absolute))
    }

    if (!inside(context.projectRoot, absolute)) {
      throw new Error(`Package path escapes the project: ${path}`)
    }

    return resolve(outDir, relative(context.projectRoot, absolute))
  }

  const validateTarget = (target: string) => {
    const files = available()
    const pattern = slash(relative(outDir, target))
    let matches = files.has(target)
    if (fg.isDynamicPattern(pattern)) {
      const escapedParts = pattern.split('*').map(part => part.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
      const expression = new RegExp(`^${escapedParts.join('.*')}$`)
      matches = [...files].some(file => expression.test(slash(relative(outDir, file))))
    }
    if (!inside(outDir, target) || !matches) {
      throw new Error(`Package entry does not match generated output: ${target}`)
    }
  }

  const rewrite = (value: Json, base = context.projectRoot): Json => {
    if (typeof value === 'string') {
      const target = targetFor(value, base)
      validateTarget(target)
      return `./${slash(relative(outDir, target))}`
    }

    if (Array.isArray(value)) {
      return value.map(entry => rewrite(entry, base))
    }

    if (value && typeof value === 'object') {
      return Object.fromEntries(Object.entries(value).map(([key, entry]) => [key, rewrite(entry, base)]))
    }

    return value
  }

  const copiedSchemas = new Set<string>()
  const copySchema = async (source: string): Promise<void> => {
    if (copiedSchemas.has(source)) {
      return
    }

    const asset = assets.get(source)
    const actualSource = await canonical(source)
    const isOutputAsset = asset !== undefined && inside(outDir, actualSource)
    if (!inside(context.projectRoot, actualSource) && !isOutputAsset) {
      throw new Error(`Unsafe schema path: ${source}`)
    }
    // Mark before following $ref so recursive schemas do not recurse forever.
    copiedSchemas.add(source)
    const data = asset ?? await readFile(source)
    if (!asset) {
      extra.set(targetFor(source), data)
    }

    if (!source.endsWith('.json')) {
      return
    }

    const walk = async (value: Json): Promise<void> => {
      if (!value || typeof value !== 'object') {
        return
      }

      if (!Array.isArray(value) && typeof value.$ref === 'string') {
        const reference = value.$ref.split('#')[0]
        if (reference && !/^[a-z][a-z0-9+.-]*:/i.test(reference)) {
          await copySchema(resolve(dirname(source), reference))
        }
      }

      for (const child of Object.values(value)) {
        await walk(child)
      }
    }

    await walk(JSON.parse(data.toString()) as Json)
  }

  if (typeof manifest.executors === 'string') {
    const source = resolve(context.projectRoot, manifest.executors)
    if (!inside(context.projectRoot, await canonical(source))) {
      throw new Error('Executor manifest must be inside the project.')
    }

    const executorManifest = await readManifest(source)
    const registry = executorManifest.executors
    if (!registry || typeof registry !== 'object' || Array.isArray(registry)) {
      throw new Error('Invalid executors manifest.')
    }

    const target = targetFor(manifest.executors)
    for (const definition of Object.values(registry)) {
      if (!definition || typeof definition !== 'object' || Array.isArray(definition) || typeof definition.implementation !== 'string') {
        throw new Error('Package generation requires native executor implementation entries.')
      }

      let implementation = resolve(dirname(source), definition.implementation)
      if (!available().has(implementation) && available().has(`${implementation}.js`)) {
        implementation += '.js'
      }
      validateTarget(implementation)
      definition.implementation = `./${slash(relative(dirname(target), implementation))}`
      if (typeof definition.schema === 'string') {
        const schemaPath = resolve(dirname(source), definition.schema)
        const actualSchema = await canonical(schemaPath)
        const isOutputAsset = assets.has(schemaPath) && inside(outDir, actualSchema)
        if (!inside(context.projectRoot, actualSchema) && !isOutputAsset) {
          throw new Error('Executor schema must be inside the project.')
        }

        const schemaTarget = targetFor(schemaPath)
        await copySchema(schemaPath)
        definition.schema = `./${slash(relative(dirname(target), schemaTarget))}`
      }
    }
    // Copy schema support files too, including local JSON Schema references.
    for (const file of await fg('schemas/**/*', { cwd: context.projectRoot, dot: true, followSymbolicLinks: false })) {
      const source = resolve(context.projectRoot, file)
      if (!inside(context.projectRoot, await canonical(source))) {
        throw new Error(`Unsafe schema path: ${source}`)
      }

      await copySchema(source)
    }
    extra.set(target, Buffer.from(`${JSON.stringify(executorManifest, null, 2)}\n`))
    manifest.executors = `./${slash(relative(outDir, target))}`
  }

  for (const name of ['README.md', 'LICENSE', 'LICENSE.md', 'NOTICE']) {
    const file = resolve(context.projectRoot, name)
    if (await existingFile(file)) {
      if (!inside(await canonical(context.projectRoot), await canonical(file))) {
        throw new Error(`Unsafe package documentation path: ${file}`)
      }
      extra.set(resolve(outDir, name), await readFile(file))
    }
  }

  const publishConfig = manifest.publishConfig && typeof manifest.publishConfig === 'object' && !Array.isArray(manifest.publishConfig)
    ? manifest.publishConfig : undefined
  const publishedExports = publishConfig?.exports
  // Publish overrides are relative to the output package, unlike source entry points.
  if (publishConfig && publishedExports !== undefined) {
    manifest.exports = rewrite(publishedExports, outDir)
    delete publishConfig.exports
  }

  for (const field of ['main', 'module', 'types', 'typings', 'bin', 'exports', 'typesVersions', 'init']) {
    if (manifest[field] !== undefined && !(field === 'exports' && publishedExports !== undefined)) {
      manifest[field] = rewrite(manifest[field])
    }
  }

  if (typeof manifest.browser === 'string') {
    manifest.browser = rewrite(manifest.browser)
  } else if (manifest.browser && typeof manifest.browser === 'object' && !Array.isArray(manifest.browser)) {
    manifest.browser = Object.fromEntries(Object.entries(manifest.browser).map(([key, value]) => [
      key.startsWith('.') ? rewrite(key) as string : key,
      typeof value === 'string' && value.startsWith('.') ? rewrite(value) : value,
    ]))
  }

  if (manifest.imports) {
    const rewriteImports = (value: Json): Json => {
      if (typeof value === 'string') {
        return value.startsWith('.') ? rewrite(value) : value
      }

      if (Array.isArray(value)) {
        return value.map(rewriteImports)
      }

      if (value && typeof value === 'object') {
        return Object.fromEntries(Object.entries(value).map(([key, entry]) => [key, rewriteImports(entry)]))
      }

      return value
    }
    manifest.imports = rewriteImports(manifest.imports)
  }

  if (manifest.main === undefined && manifest.executors === undefined) {
    const main = ['index.js', 'index.mjs', 'index.cjs'].find(file => available().has(resolve(outDir, file)))
    if (main) {
      manifest.main = `./${main}`
    }
  }

  if (manifest.types === undefined && manifest.typings === undefined && manifest.executors === undefined) {
    const types = [
      'index.d.ts',
      'index.d.mts',
      'index.d.cts',
      'types/index.d.ts',
      'types/index.d.mts',
      'types/index.d.cts',
    ].find(file => available().has(resolve(outDir, file)))
    if (types) {
      manifest.types = `./${types}`
    }
  }

  if (options.generateExportsField) {
    const exports: Record<string, Json> = {}
    if (typeof manifest.main === 'string') {
      const types = manifest.types ?? manifest.typings
      exports['.'] = { ...(typeof types === 'string' ? { types } : {}), default: manifest.main }
    }

    for (const [name, entry] of Object.entries(options.additionalEntryPoints ?? {})) {
      exports[name] = rewrite(entry, outDir)
    }

    if (manifest.exports !== undefined && Object.keys(exports).length) {
      // Existing user exports always win; additions may only fill missing subpaths.
      const existing = manifest.exports
      if (!existing || typeof existing !== 'object' || Array.isArray(existing) || !Object.keys(existing).every(key => key.startsWith('.'))) {
        if (Object.keys(options.additionalEntryPoints ?? {}).length) {
          throw new Error('Cannot merge additional entry points into conditional root exports; use a subpath exports map.')
        }
      } else {
        for (const [name, entry] of Object.entries(exports)) {
          if (!(name in existing)) {
            existing[name] = entry
          }
        }
      }
    } else if (manifest.exports === undefined && Object.keys(exports).length) {
      manifest.exports = exports
    }
  } else if (options.additionalEntryPoints) {
    throw new Error('additionalEntryPoints requires generateExportsField: true.')
  }

  await inferDependencies(manifest, root, context, options, emitted)
  await workspaceDependencies(manifest, context, root)
  for (const field of ['scripts', 'devDependencies', 'workspaces', 'packageManager', '$schema', 'files']) {
    delete manifest[field]
  }

  if (publishConfig) {
    delete publishConfig.directory
    delete publishConfig.linkDirectory
  }
  extra.set(resolve(outDir, 'package.json'), Buffer.from(json(manifest)))
  return extra
}
