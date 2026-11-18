import type { FullConfig, Reporter, Suite, TestError } from '@playwright/test/reporter'

/** Keep discovery results separate from config and test module output. */
export default class CountReporter implements Reporter {
  onBegin(config: FullConfig, suite: Suite): void {
    process.send?.({
      count: suite.allTests().filter(test => test.expectedStatus !== 'skipped').length,
      hasGlobalSetup: Boolean(config.globalSetup),
      hasShard: Boolean(config.shard),
    })
  }

  onError(error: TestError): void {
    process.stderr.write(`${error.stack ?? error.message ?? error.value}\n`)
  }
}
