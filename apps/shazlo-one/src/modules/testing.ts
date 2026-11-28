import type { ModuleEntry } from './registry'

/** A sound registry entry for tests; override what the test is about. */
export function entry(overrides: Partial<ModuleEntry> = {}): ModuleEntry {
  return {
    id: 'vendor-admin',
    title: 'Vendor admin',
    description: 'Review vendor applications.',
    url: 'https://vendor-admin.shazlo.test/',
    origin: 'https://vendor-admin.shazlo.test',
    roles: ['vendor_reviewer'],
    audience: 'vendor-api',
    supportedVersions: [1],
    ...overrides,
  }
}
