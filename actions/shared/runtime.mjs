import { execFileSync, spawn } from 'node:child_process'
import { appendFileSync, readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'

const require = createRequire(import.meta.url)

export function input(name, fallback = '') {
  return process.env[`INPUT_${name.toUpperCase()}`]?.trim() || fallback
}

export function booleanInput(name, fallback) {
  const value = input(name, String(fallback))
  if (value !== 'true' && value !== 'false') {
    throw new Error(`${name} must be true or false.`)
  }
  return value === 'true'
}

export function readJson(value, label) {
  try {
    return JSON.parse(value)
  } catch {
    throw new Error(`${label} must contain valid JSON.`)
  }
}

export function cliContext() {
  const cwd = resolve(process.env.GITHUB_WORKSPACE || process.cwd(), input('workingDirectory', '.'))
  const customCli = input('cliPath')
  if (customCli) {
    return { cwd, cli: resolve(cwd, customCli) }
  }
  let manifest
  try {
    manifest = require.resolve('isox/package.json', { paths: [cwd] })
  } catch {
    throw new Error('Install isox in the workspace before using this action, or provide cliPath to a built CLI entry point.')
  }
  const pkg = JSON.parse(readFileSync(manifest, 'utf8'))
  const bin = typeof pkg.bin === 'string' ? pkg.bin : pkg.bin?.isox
  if (!bin) {
    throw new Error('The installed isox package does not declare an isox binary.')
  }
  return { cwd, cli: resolve(dirname(manifest), bin) }
}

export function captureCli(context, args) {
  return execFileSync(process.execPath, [context.cli, ...args], {
    cwd: context.cwd,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'inherit'],
    maxBuffer: 8 * 1024 * 1024,
  })
}

export async function runCli(context, args) {
  const child = spawn(process.execPath, [context.cli, ...args], { cwd: context.cwd, stdio: 'inherit' })
  let cancelling = false
  let cancellationError
  const cancel = signal => {
    if (process.platform !== 'win32') {
      child.kill(signal)
      return
    }
    if (cancelling || !child.pid || child.exitCode !== null || child.signalCode !== null) {
      return
    }
    cancelling = true
    try {
      // Windows kill() bypasses the CLI's abort handlers. Kill descendants while
      // their parent still exists, and finish cleanup before handling CLI close.
      execFileSync('taskkill', ['/pid', String(child.pid), '/T', '/F'], { stdio: 'ignore', windowsHide: true })
    } catch (error) {
      cancellationError = new Error('Failed to terminate the Isox process tree.', { cause: error })
      child.kill()
    }
  }
  const interrupt = () => cancel('SIGINT')
  const terminate = () => cancel('SIGTERM')
  process.once('SIGINT', interrupt)
  process.once('SIGTERM', terminate)
  try {
    await new Promise((resolveRun, reject) => {
      child.once('error', reject)
      child.once('close', (code, signal) => {
        if (cancellationError) {
          reject(cancellationError)
        } else if (code === 0) {
          resolveRun()
        } else {
          reject(new Error(`Isox worker failed (${signal || `exit ${code}`}).`))
        }
      })
    })
  } finally {
    process.removeListener('SIGINT', interrupt)
    process.removeListener('SIGTERM', terminate)
  }
}

export function setOutput(name, value) {
  if (!process.env.GITHUB_OUTPUT) {
    throw new Error('GITHUB_OUTPUT is required when running an Isox action.')
  }
  const encoded = typeof value === 'string' ? value : JSON.stringify(value)
  if (/[\r\n]/.test(encoded)) {
    throw new Error(`Action output ${name} must fit on one line.`)
  }
  appendFileSync(process.env.GITHUB_OUTPUT, `${name}=${encoded}\n`)
}

export function summary(text) {
  if (process.env.GITHUB_STEP_SUMMARY) {
    appendFileSync(process.env.GITHUB_STEP_SUMMARY, text)
  }
}

export function actionMain(url, main) {
  if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === url) {
    Promise.resolve().then(main).catch(error => {
      // Escape workflow-command characters in externally supplied error messages.
      const message = (error instanceof Error ? error.message : String(error))
        .replaceAll('%', '%25').replaceAll('\r', '%0D').replaceAll('\n', '%0A')
      process.stderr.write(`::error::${message}\n`)
      process.exitCode = 1
    })
  }
}
