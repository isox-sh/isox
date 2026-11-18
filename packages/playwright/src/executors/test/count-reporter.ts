import type { FullConfig, Reporter, Suite, TestError } from '@playwright/test/reporter'

/** Keep discovery results separate from config and test module output. */
export default class CountReporter implements Reporter {
  onBegin(_config: FullConfig, suite: Suite): void {
    const count = suite.allTests().filter(test => test.expectedStatus !== 'skipped').length
    process.send?.(count)
  }

  onError(error: TestError): void {
    process.stderr.write(`${error.stack ?? error.message ?? error.value}\n`)
  }
}
