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
}

export interface LogReporter {
  log(entry: LogObject): void
}

export interface LoggerOptions {
  level?: number
  tag?: string
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
  debug(...args: unknown[]): void
  info(...args: unknown[]): void
  success(...args: unknown[]): void
  warn(...args: unknown[]): void
  error(...args: unknown[]): void
  withTag(tag: string): Logger
}

/** Create an independent logger that writes immediately, with automatic terminal colors. */
export function createLogger(options: LoggerOptions = {}): Logger {
  const tag = options.tag ?? 'Isox'
  const reporters = options.reporters ?? [{
    log(entry: LogObject) {
      const stream = entry.level <= LogLevels.warn
        ? options.stderr ?? process.stderr
        : options.stdout ?? process.stdout
      const colors = options.colors ?? supportsColors(stream)
      const tag = entry.tag ? `[${entry.tag}]` : ''
      const prefix = tag ? `${colors ? colorize(tag, 90) : tag} ` : ''
      const label = entry.type.toUpperCase()
      const level = colors ? colorize(label, levelColors[entry.type]) : label
      const message = formatWithOptions({ colors: false }, ...entry.args)

      stream.write(`${prefix}${level} ${message}\n`)
    },
  }]

  const emit = (type: LogType, args: unknown[]): void => {
    const level = LogLevels[type]

    if (level > instance.level) {
      return
    }

    for (const reporter of reporters) {
      reporter.log({
        type,
        level,
        tag,
        args
      })
    }
  }

  const instance: Logger = {
    level: options.level ?? LogLevels.info,
    tag,
    debug: (...args) => emit('debug', args),
    info: (...args) => emit('info', args),
    success: (...args) => emit('success', args),
    warn: (...args) => emit('warn', args),
    error: (...args) => emit('error', args),
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
