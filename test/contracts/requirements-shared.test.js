import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { resolve } from 'node:path'
import { URL, fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

// Dependabot's pip updater (dependabot-core, shared_file_fetcher.rb) finds path dependencies in a
// requirements file with these two patterns, then fetches setup.py or pyproject.toml from each path.
// The editable pattern reads everything after `-e` up to a `[`, `#`, quote or `;` as the path, so
// `-e ../../packages/py-security --config-settings editable_mode=compat` yields a path that does not
// exist, and the whole pip update job fails (PathDependenciesNotReachable) for every Python service.
const UNEDITABLE = /^['"]?(?:file:)?(\.[^[#'"\n;]*)/gm
const EDITABLE = /^-e\s+['"]?(?:file:)?([^[#'"\n;]*)/gm
const root = fileURLToPath(new URL('../../', import.meta.url))

const detectedPaths = (content) =>
  [...content.matchAll(UNEDITABLE), ...content.matchAll(EDITABLE)]
    .map((match) => match[1].trim())
    .filter((path) => !path.includes('://') && !path.includes('git@'))

const servicesWithSharedPackages = readdirSync(resolve(root, 'services'), { withFileTypes: true })
  .filter((entry) => entry.isDirectory() && existsSync(resolve(root, 'services', entry.name, 'requirements-shared.txt')))
  .map((entry) => entry.name)

describe('requirements-shared.txt', () => {
  it('exists for the services that use the shared packages', () => {
    expect(servicesWithSharedPackages).toEqual(expect.arrayContaining(['identity-api', 'vendor-api']))
  })

  describe.each(servicesWithSharedPackages)('services/%s', (service) => {
    const directory = resolve(root, 'services', service)
    const content = readFileSync(resolve(directory, 'requirements-shared.txt'), 'utf8')
    const requirementLines = content.split(/\r?\n/).filter((line) => line.trim() && !line.trim().startsWith('#'))

    it('installs each shared package from its path, in compat mode, with the option before -e', () => {
      expect(requirementLines.length).toBeGreaterThan(0)
      for (const line of requirementLines) {
        expect(line, 'option must come first so Dependabot does not read it as part of the path').toMatch(
          /^--config-settings editable_mode=compat -e \.\.\/\.\.\/packages\/py-[a-z]+(\[[a-z,]+\])?$/,
        )
      }
    })

    it('gives Dependabot only paths it can fetch (a package directory with a pyproject.toml)', () => {
      // Dependabot may either skip a line or fetch it, but it must never fail to find the path.
      for (const path of detectedPaths(content)) {
        expect(existsSync(resolve(directory, path, 'pyproject.toml')), `Dependabot would read "${path}" as a path`).toBe(true)
      }
    })

    it('never lists a shared package in pyproject.toml, where an index could answer for it', () => {
      const pyproject = readFileSync(resolve(directory, 'pyproject.toml'), 'utf8')
      const dependencies = /\ndependencies\s*=\s*\[([\s\S]*?)\n\]/.exec(pyproject)?.[1] ?? ''
      const active = dependencies.split('\n').filter((line) => !line.trim().startsWith('#')).join('\n')
      expect(active).not.toMatch(/shazlo[-_](auth|security)/i)
    })
  })

  it('would have caught the flag-after-path form that broke Dependabot', () => {
    const broken = '-e ../../packages/py-security --config-settings editable_mode=compat\n'
    expect(detectedPaths(broken)).toEqual(['../../packages/py-security --config-settings editable_mode=compat'])
    const bracketed = '-e ../../packages/py-auth[fastapi] --config-settings editable_mode=compat\n'
    expect(detectedPaths(bracketed)).toEqual(['../../packages/py-auth'])
    const fixed = '--config-settings editable_mode=compat -e ../../packages/py-security\n'
    expect(detectedPaths(fixed)).toEqual([])
  })
})
