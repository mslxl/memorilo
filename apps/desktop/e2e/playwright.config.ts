import process from 'node:process'
import { defineConfig } from '@playwright/test'

// The Electron package may be resolved from a Node process that inherits this flag;
// remove it before Playwright launches the Electron executable or Electron will run as Node.
delete process.env.ELECTRON_RUN_AS_NODE
process.env.MEMORILO_E2E_HIDE_WINDOW = '1'
process.env.MEMORILO_E2E_USE_USER_DATA = '1'
process.env.MEMORILO_SHELF_IMAGE_CACHE_PATH = ':memory:'
// The host runner exports this for Electron's Node tooling; passing it through
// makes Playwright launch Electron in Node mode instead of application mode.
delete process.env.ELECTRON_RUN_AS_NODE

export default defineConfig({
  fullyParallel: false,
  retries: 0,
  testDir: './tests',
  timeout: 60_000,
  // Each worker launches full Electron, PDF, SQLite, and embedding runtimes.
  // Two workers oversubscribe the supported Windows test host and make the
  // suite slower through timeouts and worker teardown failures.
  workers: 1,
})
