import { formatWithOptions } from 'node:util'

interface LogStream extends Pick<NodeJS.WritableStream, 'write'> {
  isTTY?: boolean
}

export const LogLevels = {
  silent: -Infinity,
  error: 0,
  warn: 1,
  info: 3,
  success: 3,
  debug: 4,
} as const

export type LogType = Exclude<keyof typeof LogLevels, 'silent'>

export interface LogObject {
  type: LogType
  level: number
  tag: string
  args: unknown[]
  format?: 'task'
}

export interface LogReporter {
  log(entry: LogObject): void
  progress?(entry: LogObject): () => void
}

export interface LoggerOptions {
  level?: number
  tag?: string
  /** Render executor lifecycle results as compact task lines. */
  taskOutput?: 'compact'
  /** Enable colors explicitly, or detect terminal support by default. */
  colors?: boolean
  reporters?: LogReporter[]
  stdout?: LogStream
  stderr?: LogStream
}

const levelColors: Record<LogType, number> = {
  error: 31,
  warn: 33,
  info: 36,
  success: 32,
  debug: 35,
}

function supportsColors(stream: LogStream): boolean {
  if (process.env.FORCE_COLOR !== undefined) {
    return process.env.FORCE_COLOR !== '0'
  }

  return !process.env.NO_COLOR && process.env.TERM !== 'dumb' && stream.isTTY === true
}

function colorize(text: string, color: number): string {
  return `\u001b[${color}m${text}\u001b[39m`
}

export interface Logger {
  level: number
  readonly tag: string
  readonly taskOutput?: 'compact'
  debug(...args: unknown[]): void
  info(...args: unknown[]): void
  success(...args: unknown[]): void
  warn(...args: unknown[]): void
  error(...args: unknown[]): void
  /** Compact task status, rendered with a success, failure, or cancellation glyph. */
  task?(message: string, status?: 'success' | 'error' | 'warn'): void
  /** Start a terminal progress indicator and return an idempotent cleanup function. */
  progress?(message: string): () => void
  withTag(tag: string): Logger
}

interface ProgressIndicator {
  render(): void
  clear(): void
  pause(): void
  resume(): void
  stop(): void
}

const indicators = new Set<ProgressIndicator>()
let progressPauses = 0

/** Let inherited child output own the terminal until it closes. */
export function pauseProgress(): () => void {
  if (progressPauses++ === 0) {
    for (const indicator of indicators) {
      indicator.pause()
    }
  }

  let resumed = false

  return () => {
    if (resumed) {
      return
    }

    resumed = true

    if (--progressPauses === 0) {
      for (const indicator of indicators) {
        indicator.resume()
      }
    }
  }
}

function consoleReporter(options: LoggerOptions): LogReporter {
  let active: ProgressIndicator | undefined

  return {
    log(entry: LogObject) {
      const stream = entry.level <= LogLevels.warn
        ? options.stderr ?? process.stderr
        : options.stdout ?? process.stdout
      const colors = options.colors ?? supportsColors(stream)
      const tag = entry.tag && entry.format !== 'task' ? `[${entry.tag}]` : ''
      const prefix = tag ? `${colors ? colorize(tag, 90) : tag} ` : ''
      const label = entry.format === 'task'
        ? entry.type === 'success' ? '✔' : entry.type === 'error' ? '✖' : '–'
        : entry.type.toUpperCase()
      const level = colors ? colorize(label, levelColors[entry.type]) : label
      const message = formatWithOptions({ colors: false }, ...entry.args)

      active?.clear()
      stream.write(`${prefix}${level} ${message}\n`)
      active?.render()
    },
    progress(entry) {
      const stream = options.stdout ?? process.stdout

      if (!stream.isTTY || process.env.TERM === 'dumb' || process.env.CI || process.env.ISOX_PROGRESS === '0') {
        this.log(entry)

        return () => {}
      }

      active?.stop()
      const frames = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏']
      const colors = options.colors ?? supportsColors(stream)
      const tag = entry.tag ? `[${entry.tag}] ` : ''
      const prefix = colors ? colorize(tag, 90) : tag
      const message = formatWithOptions({ colors: false }, ...entry.args)
      let frame = 0
      let visible = false
      const clear = () => {
        if (visible) {
          stream.write('\r\u001b[2K')
          visible = false
        }
      }

      const render = () => {
        if (progressPauses) {
          return
        }

        const glyph = frames[frame++ % frames.length]

        clear()
        stream.write(`${prefix}${colors ? colorize(glyph, 36) : glyph} ${message}`)
        visible = true
      }

      const timer = setInterval(render, 80)

      timer.unref()
      const progress = {
        render,
        clear,
        pause() {
          clear()
          stream.write(`${prefix}INFO ${message}\n`)
        },
        resume() {
          // An inherited child may finish with a partial line. Never erase its final output.
          stream.write('\n')
          render()
        },
        stop() {
          clearInterval(timer)
          indicators.delete(progress)

          if (active === progress) {
            clear()
            active = undefined
          }
        }
      }

      active = progress
      indicators.add(progress)

      if (progressPauses) {
        progress.pause()
      } else {
        render()
      }

      return progress.stop
    }
  }
}

/** Create an independent logger that writes immediately, with automatic terminal colors. */
export function createLogger(options: LoggerOptions = {}): Logger {
  const tag = options.tag ?? 'Isox'
  const reporters = options.reporters ?? [consoleReporter(options)]

  const emit = (type: LogType, args: unknown[], format?: 'task'): void => {
    const level = LogLevels[type]

    if (level > instance.level) {
      return
    }

    for (const reporter of reporters) {
      reporter.log({
        type,
        level,
        tag,
        args,
        ...(format ? { format } : {})
      })
    }
  }

  const instance: Logger = {
    level: options.level ?? LogLevels.info,
    tag,
    taskOutput: options.taskOutput,
    debug: (...args) => emit('debug', args),
    info: (...args) => emit('info', args),
    success: (...args) => emit('success', args),
    warn: (...args) => emit('warn', args),
    error: (...args) => emit('error', args),
    task: (message, status = 'success') => emit(status, [message], 'task'),
    progress(message) {
      if (instance.level < LogLevels.info) {
        return () => {}
      }

      const entry: LogObject = {
        type: 'info',
        level: LogLevels.info,
        tag,
        args: [message]
      }
      const stops = reporters.map(reporter => {
        if (reporter.progress) {
          return reporter.progress(entry)
        }

        reporter.log(entry)

        return () => {}
      })

      return () => {
        stops.splice(0).forEach(stop => stop())
      }
    },
    withTag: childTag => createLogger({
      ...options,
      level: instance.level,
      tag: [tag, childTag].filter(Boolean).join(':'),
      reporters,
    }),
  }

  return instance
}

export const logger = createLogger()
