/** Schedule already validated work with prerequisite and exclusive-task constraints. */
export function createSchedule(ids: Iterable<string>, prerequisites: Map<string, Set<string>>, exclusive: Set<string>, signal: AbortSignal) {
  const pending = new Set(ids)
  const completed = new Set<string>()
  const running = new Set<string>()
  const waiting = new Set<() => void>()

  return {
    async next(): Promise<string | undefined> {
      while (!signal.aborted && pending.size) {
        for (const name of pending) {
          if ((exclusive.has(name) ? running.size === 0 : ![...running].some(project => exclusive.has(project)))
            && [...prerequisites.get(name) ?? []].every(dependency => completed.has(dependency))) {
            pending.delete(name)
            running.add(name)

            return name
          }
        }

        await new Promise<void>(resolve => {
          const wake = () => {
            waiting.delete(wake)
            signal.removeEventListener('abort', wake)
            resolve()
          }

          waiting.add(wake)
          signal.addEventListener('abort', wake, { once: true })
        })
      }

      return undefined
    },
    done(name: string): void {
      running.delete(name)
      completed.add(name)
      for (const wake of waiting) {
        wake()
      }
    }
  }
}
