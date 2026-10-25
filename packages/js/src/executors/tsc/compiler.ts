import { spawn } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { mkdir, rm } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { dirname, resolve } from 'node:path'
import { createInterface } from 'node:readline'

export interface CompilerConfig {
  compilerOptions: {
    outDir?: string
    declarationDir?: string
    rootDir?: string
    outFile?: string
    noEmit?: boolean
    incremental?: boolean
    composite?: boolean
    tsBuildInfoFile?: string
    [key: string]: unknown
  }
  files?: string[]
}

interface CompilerResult {
  success: boolean
  output: string
  emitted: string[]
}

const packagePath = createRequire(__filename).resolve('@typescript/native/package.json')
const compiler = JSON.parse(readFileSync(packagePath, 'utf8'))
const executable = resolve(dirname(packagePath), compiler.bin.tsc)

export class CompilerProcessError extends Error {
  readonly code?: string

  constructor(error: NodeJS.ErrnoException) {
    super(`TypeScript process failed: ${error.message}`, { cause: error })
    this.code = error.code
  }
}

/** Use process groups so cancellation also stops the launcher's native child. */
export async function invokeCompiler(
  args: string[],
  cwd: string,
  signal?: AbortSignal,
  emitLog = false,
): Promise<CompilerResult> {
  if (signal?.aborted) {
    return { success: false, output: '', emitted: [] }
  }

  return new Promise<CompilerResult>((resolveResult, reject) => {
    const child = spawn(process.execPath, [executable, ...args], {
      cwd,
      detached: process.platform !== 'win32',
      stdio: ['ignore', 'pipe', 'pipe'],
    })
    let output = ''
    const emitted: string[] = []
    let killTimer: ReturnType<typeof setTimeout> | undefined
    const kill = (force = false) => {
      if (!child.pid) {
        return
      }

      try {
        if (process.platform === 'win32') {
          const killer = spawn('taskkill', ['/pid', String(child.pid), '/T', '/F'], { stdio: 'ignore' })
          killer.on('error', () => child.kill())
        } else {
          process.kill(-child.pid, force ? 'SIGKILL' : 'SIGTERM')
        }
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'ESRCH') {
          reject(error)
        }
      }
    }

    const abort = () => {
      kill()
      killTimer = setTimeout(() => kill(true), 2_000)
      killTimer.unref()
    }
    signal?.addEventListener('abort', abort, { once: true })
    const cleanup = () => {
      signal?.removeEventListener('abort', abort)
      // The launcher may exit while a native child is still ignoring SIGTERM.
      if (signal?.aborted) {
        kill(true)
      }
      clearTimeout(killTimer)
    }

    for (const stream of [child.stdout, child.stderr]) {
      const lines = createInterface({ input: stream })
      lines.on('line', line => {
        if (line.startsWith('TSFILE: ')) {
          emitted.push(resolve(cwd, line.slice(8)))
        } else {
          output += `${line}\n`
          if (emitLog) {
            (stream === child.stderr ? process.stderr : process.stdout).write(`${line}\n`)
          }
        }
      })
    }
    child.once('error', error => {
      cleanup()
      reject(new CompilerProcessError(error))
    })
    child.once('close', (code, terminationSignal) => {
      cleanup()
      if (terminationSignal && !signal?.aborted) {
        reject(new CompilerProcessError(new Error(`Compiler terminated by ${terminationSignal}.`)))
        return
      }
      resolveResult({ success: code === 0 && !signal?.aborted, output, emitted })
    })
    if (signal?.aborted) {
      abort()
    }
  })
}

export async function readConfig(tsConfig: string, root: string, signal?: AbortSignal) {
  const result = await invokeCompiler(['--project', tsConfig, '--showConfig', '--pretty', 'false'], root, signal)
  return { ...result, config: result.success ? JSON.parse(result.output) as CompilerConfig : undefined }
}

export async function compile(tsConfig: string, root: string, stateFile: string, config: CompilerConfig, signal?: AbortSignal) {
  const args = [
    '--project',
    tsConfig,
    '--noEmitOnError',
    'true',
    '--listEmittedFiles',
    'true',
    '--pretty',
    'false',
  ]
  if (config.compilerOptions.incremental || config.compilerOptions.composite) {
    // Re-emit every file so stale-output accounting is complete on every build.
    const buildInfo = `${stateFile}.tsbuildinfo`
    await mkdir(dirname(buildInfo), { recursive: true })
    await rm(buildInfo, { force: true })
    args.push('--tsBuildInfoFile', buildInfo)
  }

  return invokeCompiler(args, root, signal, true)
}
