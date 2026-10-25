/** Keep shell exit codes while executors and child processes shut down cooperatively. */
export async function withCancellation(run: (controller: AbortController) => Promise<void>): Promise<void> {
  const controller = new AbortController()
  const interrupt = () => {
    process.exitCode = 130
    controller.abort()
  }

  const terminate = () => {
    process.exitCode = 143
    controller.abort()
  }

  process.once('SIGINT', interrupt)
  process.once('SIGTERM', terminate)

  try {
    await run(controller)
  } finally {
    process.removeListener('SIGINT', interrupt)
    process.removeListener('SIGTERM', terminate)
  }
}
