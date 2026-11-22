import { describe, expect, it } from 'vitest'
import { isOutboxStatus, OUTBOX_STATUSES, outboxPill } from './status'

// Shazlo One's home links to /vendors/publishing?status=<one of these>.
describe('outbox statuses in a link', () => {
  it('are the four the outbox has, each with a pill', () => {
    expect(OUTBOX_STATUSES).toEqual(['waiting', 'retrying', 'failed', 'delivered'])
    for (const status of OUTBOX_STATUSES) expect(outboxPill[status]).toBeDefined()
  })

  it('accepts exactly those, as written', () => {
    for (const status of OUTBOX_STATUSES) expect(isOutboxStatus(status)).toBe(true)
    for (const other of [null, '', 'all', 'Failed', 'FAILED', ' failed', 'failed ', 'pending', 'retry', 'delivered,failed', '__proto__', 'toString']) {
      expect(isOutboxStatus(other)).toBe(false)
    }
  })
})
