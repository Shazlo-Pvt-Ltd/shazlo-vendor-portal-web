import type { Submission } from './rules'

/** A submission as `GET /v1/vendor/submissions` lists it: a product, approved, unless overridden. */
export function submission(overrides: Partial<Submission> = {}): Submission {
  return {
    subject: 'product',
    id: 'p1',
    sku: 'KRT-001',
    title: 'Indigo kurta',
    version: 1,
    status: 'approved',
    reason: null,
    submitted_at: '2026-11-10T09:30:00Z',
    decided_at: '2026-11-11T12:00:00Z',
    ...overrides,
  }
}
