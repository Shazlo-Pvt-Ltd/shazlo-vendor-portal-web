import { execFileSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { expect, it } from 'vitest'

const runner = fileURLToPath(new URL('../../node_modules/vitest/vitest.mjs', import.meta.url))

it.each([
  ['app', 'legacy-app', 'test/feed-queue.test.js'],
  ['backend', 'legacy-backend', 'test/api.integration.test.js'],
])('discovers production tests when invoked from the %s directory', (directory, project, expectedFile) => {
  const output = execFileSync(process.execPath, [runner, 'list', '--config', '../vitest.config.ts', '--project', project, '--filesOnly'], {
    cwd: fileURLToPath(new URL(`../../${directory}/`, import.meta.url)),
    encoding: 'utf8', timeout: 10_000,
  })
  expect(output.replaceAll('\\', '/')).toContain(expectedFile)
})
