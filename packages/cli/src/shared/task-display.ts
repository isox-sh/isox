import { StringDecoder } from 'node:string_decoder'
import { stripVTControlCharacters } from 'node:util'

interface DisplayStream extends Pick<NodeJS.WriteStream, 'write'> {
  isTTY?: boolean
  columns?: number
  rows?: number
}

interface TaskRow {
  reference: string
  started: number
  status?: 'success' | 'error' | 'warn'
  result?: TaskResult
  output: string
  truncated: boolean
  decoders: Record<'stdout' | 'stderr', StringDecoder>
}

interface TaskResult {
  type: 'isox:task-result'
  message: string
  status: 'success' | 'error' | 'warn'
}

interface TaskDisplayOptions {
  stdout?: DisplayStream
  stderr?: DisplayStream
  target?: string
  total?: number
  colors?: boolean
}

function isTaskResult(value: unknown): value is TaskResult {
  if (!value || typeof value !== 'object') {
    return false
  }

  const result = value as Partial<TaskResult>

  return result.type === 'isox:task-result' && typeof result.message === 'string'
    && ['success', 'error', 'warn'].includes(result.status ?? '')
}

/** Completed results stay in scrollback; only the live progress footer is redrawn. */
export function createTaskDisplay(options: TaskDisplayOptions = {}) {
  const stdout = options.stdout ?? process.stdout
  const stderr = options.stderr ?? process.stderr
  const interactive = Boolean(stdout.isTTY && stderr.isTTY && !process.env.CI && process.env.TERM !== 'dumb' && process.env.ISOX_PROGRESS !== '0')
  const colors = options.colors ?? (process.env.FORCE_COLOR !== undefined
    ? process.env.FORCE_COLOR !== '0'
    : Boolean(stdout.isTTY && !process.env.NO_COLOR && process.env.TERM !== 'dumb'))
  const paint = (text: string, code: string) => colors ? `\u001b[${code}m${text}\u001b[0m` : text
  const tasks = new Map<string, TaskRow>()
  const frames = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏']
  const started = performance.now()
  let frame = 0
  let visibleLines = 0
  let columns = stdout.columns
  let rows = stdout.rows
  let stopped = false
  let partialOutput = false
  const total = () => options.total ?? tasks.size
  const elapsed = (since: number) => `${((performance.now() - since) / 1000).toFixed(2)}s`
  const count = (status: TaskRow['status']) => [...tasks.values()].filter(task => task.status === status).length
  const cached = () => [...tasks.values()].filter(task => task.status === 'success' && task.result?.message.includes('(cache hit ')).length
  const clear = () => {
    if (visibleLines) {
      // Resizing can reflow old rows. Never erase using their stale positions.
      stdout.write(columns !== stdout.columns || rows !== stdout.rows ? '\n' : `\u001b[${visibleLines}A\r\u001b[J`)
      visibleLines = 0
    }

    columns = stdout.columns
    rows = stdout.rows
  }

  const fit = (text: string) => {
    let width = 0
    let fitted = ''
    for (const character of stripVTControlCharacters(text)) {
      const char = character.codePointAt(0)! < 32 || character === '\u007f' ? ' ' : character
      width += char.codePointAt(0)! > 127 ? 2 : 1
      if (width > (stdout.columns || 80) - 2) {
        return `${fitted}…`
      }

      fitted += char
    }

    return fitted
  }

  const render = () => {
    if (stopped || !interactive) {
      return
    }

    clear()
    const running = [...tasks.values()].filter(task => !task.status)
    const completed = tasks.size - running.length
    const height = Math.max(1, (stdout.rows || 24) - 2)
    const progress = total() ? Math.min(10, Math.floor(completed / total() * 10)) : 0
    const bar = `${'='.repeat(progress)}${'-'.repeat(10 - progress)}`
    const heading = `   Running ${options.target ? `target ${options.target}` : 'tasks'} for ${total()} project${total() === 1 ? '' : 's'}`
    const progressLine = `   → [${bar}] ${running.length} running · ${total() - completed - running.length} pending · ${completed}/${total()} completed`
    const runningLines = running.map(task => `   ${frames[frame % frames.length]} isox run ${task.reference} (${elapsed(task.started)})`)
    const results = `   ✔ ${count('success')} succeeded [${cached()} read from cache]${count('error') ? ` · ✖ ${count('error')} failed` : ''}${count('warn') ? ` · ${count('warn')} cancelled` : ''}`
    const compactLines = [heading, progressLine, ...runningLines, results]
    const lines = [
      '', heading, '', progressLine, '',
      ...runningLines, '', results, ''
    ]
    const visible = lines.length <= height ? lines : compactLines.length <= height ? compactLines : [
      ...compactLines.slice(0, Math.min(2, height - 1)),
      ...running.slice(0, Math.max(0, height - 3)).map(task => `   ${frames[frame % frames.length]} isox run ${task.reference}`),
      `  … ${running.length} running · ${completed}/${total()} completed`
    ].slice(0, height)

    stdout.write(`${visible.map(line => {
      const fitted = fit(line)

      return paint(fitted, line.startsWith('   Running ') ? '1;36' : line.includes(' failed') ? '31' : line.includes('succeeded') ? '32' : '36')
    }).join('\n')}\n`)
    visibleLines = visible.length
  }

  const timer = interactive ? setInterval(() => {
    frame++
    render()
  }, 80) : undefined

  timer?.unref()
  const append = (task: TaskRow, text: string) => {
    const output = task.output + text

    task.truncated ||= output.length > 262144
    task.output = output.slice(-262144)
  }

  return {
    interactive,
    start(name: string, reference: string) {
      if (stopped) {
        return
      }

      tasks.set(name, {
        reference,
        started: performance.now(),
        output: '',
        truncated: false,
        decoders: {
          stdout: new StringDecoder(),
          stderr: new StringDecoder()
        }
      })
      render()
    },
    message(name: string, value: unknown) {
      const task = tasks.get(name)
      if (task && !task.status && isTaskResult(value)) {
        task.result = value
      }
    },
    output(name: string, chunk: Buffer, stream: 'stdout' | 'stderr') {
      if (stopped) {
        return
      }

      const task = tasks.get(name)
      if (interactive && task) {
        append(task, task.decoders[stream].write(chunk))
      } else {
        // CI and redirected logs remain complete and stream without cursor controls.
        const destination = stream === 'stdout' ? stdout : stderr

        destination.write(chunk)
        if (chunk.length) {
          partialOutput = chunk[chunk.length - 1] !== 10
        }
      }
    },
    finish(name: string, success: boolean, cancelled: boolean) {
      const task = tasks.get(name)
      if (stopped || !task || task.status) {
        return
      }

      clear()
      task.status = success ? 'success' : cancelled ? 'warn' : 'error'
      append(task, task.decoders.stdout.end() + task.decoders.stderr.end())
      const glyph = success ? '✔' : cancelled ? '–' : '✖'
      const detail = success && task.result?.status === 'success' && task.result.message.includes('(cache hit ')
        ? '[local cache]'
        : `(${cancelled ? 'cancelled after ' : success ? '' : 'failed after '}${elapsed(task.started)})`
      const destination = success ? stdout : stderr

      if (partialOutput || !success || count('success') + count('error') + count('warn') === 1) {
        destination.write('\n')
      }

      partialOutput = false
      destination.write(`   ${paint(glyph, success ? '32' : cancelled ? '33' : '31')} ${paint(`isox run ${task.reference}`, success ? '1' : cancelled ? '33' : '1;31')} ${paint(detail, '2')}\n`)
      if (interactive && !success && task.output.trim()) {
        const output = stripVTControlCharacters(task.output).trimEnd()

        destination.write(`\n${task.truncated ? '      [Earlier output omitted; showing recent output]\n' : ''}${output.split(/\r?\n/).map(line => `      ${paint(line, /error|failed|TS\d{4}/i.test(line) ? '31' : '2')}`).join('\n')}\n`)
      }

      task.output = ''
      render()
    },
    stop() {
      if (stopped) {
        return
      }

      if (timer) {
        clearInterval(timer)
      }

      clear()
      const succeeded = count('success')
      const failed = count('error')
      const cancelled = count('warn')
      const incomplete = total() - succeeded - failed - cancelled
      const summary = succeeded === total()
        ? `Successfully ran ${options.target ? `target ${options.target}` : 'tasks'} for ${total()} project${total() === 1 ? '' : 's'} (${elapsed(started)})`
        : `Ran ${options.target ? `target ${options.target}` : 'tasks'}: ${succeeded} succeeded, ${failed} failed, ${cancelled} cancelled, ${incomplete} not run (${elapsed(started)})`
      const destination = failed || cancelled || incomplete ? stderr : stdout

      destination.write(`\n${paint(`${interactive ? '   ' : 'ISOX  '}${summary}`, failed ? '1;31' : cancelled || incomplete ? '1;33' : '1;32')}\n`)
      if (failed) {
        destination.write(`\n${paint('   Failed tasks:', '31')}\n${[...tasks.values()].filter(task => task.status === 'error').map(task => `      - ${paint(task.reference, '31')}`).join('\n')}\n`)
      }

      if (cached()) {
        destination.write(`\n${paint(`${interactive ? '   ' : '      '}${cached()}/${total()} tasks read from cache`, '2')}\n`)
      }

      destination.write('\n')
      stopped = true
    }
  }
}
