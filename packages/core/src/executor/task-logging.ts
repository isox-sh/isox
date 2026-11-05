import { withoutOutputCapture } from '../cache/output'

import type { ExecutorContext } from './types'

export const compactTaskOutput = (context: ExecutorContext): boolean => context.logger.taskOutput === 'compact'

export function reportTaskResult(context: ExecutorContext, status: 'success' | 'error' | 'warn', detail: string): void {
  const reference = [context.projectName, context.commandName, context.configurationName].filter(value => value !== undefined).join(':')
  const message = `isox run ${reference} (${detail})`

  withoutOutputCapture(() => {
    if (context.logger.task) {
      context.logger.task(message, status)
    } else {
      context.logger[status](message)
    }
  })
}
