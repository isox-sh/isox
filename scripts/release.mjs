import { spawnSync } from 'node:child_process'
import { readdir, readFile, realpath } from 'node:fs/promises'
import { isAbsolute, join, relative, resolve, sep } from 'node:path'
import { pathToFileURL } from 'node:url'
import { parseArgs } from 'node:util'

const registry = 'https://registry.npmjs.org/'
const workspaceRoot = resolve(import.meta.dirname, '..')

function runCommand(command, args, cwd) {
  const result = spawnSync(command, args, {
    cwd,
    stdio: 'inherit'
  })

  if (result.error) {
    throw result.error
  }

  if (result.status !== 0) {
    throw new Error(`${command} ${args.join(' ')} failed (${result.signal ?? result.status}).`)
  }
}

const readJson = async path => JSON.parse(await readFile(path, 'utf8'))

async function releasePackages(root, version) {
  const packages = new Map()
  const outputRoot = await realpath(join(root, 'dist'))

  for (const entry of await readdir(join(root, 'packages'), { withFileTypes: true })) {
    if (!entry.isDirectory()) {
      continue
    }

    const projectRoot = join(root, 'packages', entry.name)
    const source = await readJson(join(projectRoot, 'package.json'))

    if (source.private) {
      continue
    }

    const directory = source.publishConfig?.directory

    if (typeof directory !== 'string' || !directory) {
      throw new Error(`${source.name} must declare publishConfig.directory.`)
    }

    const output = await realpath(resolve(projectRoot, directory))
    const path = relative(outputRoot, output)

    if (!path || path === '..' || path.startsWith(`..${sep}`) || isAbsolute(path)) {
      throw new Error(`${source.name} must publish a package inside dist.`)
    }

    const manifest = await readJson(join(output, 'package.json'))

    if (!manifest.name || manifest.name !== source.name || manifest.version !== source.version || manifest.private) {
      throw new Error(`Built package metadata does not match ${source.name}.`)
    }

    if (version !== undefined && manifest.version !== version) {
      throw new Error(`${manifest.name} has version ${manifest.version}; expected ${version}.`)
    }

    if (packages.has(manifest.name)) {
      throw new Error(`Duplicate package name: ${manifest.name}.`)
    }

    packages.set(manifest.name, {
      manifest,
      output
    })
  }

  if (!packages.size) {
    throw new Error('No public packages found.')
  }

  // Inspect generated dependencies: source manifests deliberately omit inferred workspace imports.
  const ordered = []
  const visiting = new Set()
  const visited = new Set()
  const visit = name => {
    if (visiting.has(name)) {
      throw new Error(`Circular package dependency involving ${name}.`)
    }

    if (visited.has(name)) {
      return
    }

    visiting.add(name)
    const pkg = packages.get(name)
    const dependencies = {
      ...pkg.manifest.dependencies,
      ...pkg.manifest.optionalDependencies
    }

    for (const [dependency, range] of Object.entries(dependencies)) {
      if (/^(workspace|file|link):/.test(range)) {
        throw new Error(`${name} contains an unpublished dependency: ${dependency}@${range}.`)
      }

      if (packages.has(dependency)) {
        visit(dependency)
      }
    }

    visiting.delete(name)
    visited.add(name)
    ordered.push(pkg)
  }

  for (const name of [...packages.keys()].sort()) {
    visit(name)
  }

  return ordered
}

export function assertReleaseAllowed(tag, dryRun, env = process.env) {
  if (!['alpha', 'beta', 'latest'].includes(tag)) {
    throw new Error('Choose --tag alpha, beta, or latest (for stable releases).')
  }

  if (!dryRun && (env.GITHUB_ACTIONS !== 'true' || !env.ACTIONS_ID_TOKEN_REQUEST_URL || !env.ACTIONS_ID_TOKEN_REQUEST_TOKEN)) {
    throw new Error('Publishing requires GitHub Actions OIDC with id-token: write. Use --dry-run locally.')
  }

}

export async function release(options, run = runCommand, env = process.env) {
  const { root = workspaceRoot, tag, version, dryRun = false } = options

  assertReleaseAllowed(tag, dryRun, env)

  // Versioning happens after the workflow's initial bootstrap. Rebuild with the new versions.
  run('pnpm', ['bootstrap'], root)

  const packages = await releasePackages(root, version)

  for (const { manifest } of packages) {
    const prerelease = manifest.version.split('+')[0].split('-').slice(1).join('-')

    if ((tag === 'latest' && prerelease) || (tag !== 'latest' && !prerelease.startsWith(`${tag}.`))) {
      throw new Error(`${manifest.name}@${manifest.version} does not match the ${tag} release channel.`)
    }
  }

  // Preflight every tarball before the first irreversible publication. Lifecycle scripts are unnecessary after bootstrap.
  for (const { manifest, output } of packages) {
    console.log(`[Isox] Checking ${manifest.name}@${manifest.version}`)
    run('npm', ['pack', '--dry-run', '--ignore-scripts'], output)
  }

  for (const { manifest, output } of packages) {
    console.log(`[Isox] ${dryRun ? 'Would publish' : 'Publishing'} ${manifest.name}@${manifest.version} with tag ${tag}`)

    if (!dryRun) {
      run('npm', ['publish', '--access', 'public', '--tag', tag, '--registry', registry, '--provenance', '--ignore-scripts'], output)
    }
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  try {
    const { values } = parseArgs({
      options: {
        'tag': { type: 'string' },
        'version': { type: 'string' },
        'dry-run': {
          type: 'boolean',
          default: false
        }
      }
    })

    await release({
      tag: values.tag,
      version: values.version,
      dryRun: values['dry-run']
    })
  } catch (error) {
    console.error(`[Isox] ERROR ${error.message}`)
    process.exitCode = 1
  }
}
