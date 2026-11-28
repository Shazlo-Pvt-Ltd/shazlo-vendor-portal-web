import { mockModuleToken } from '@shazlo/mock-vendor-api'
import { beforeEach, describe, expect, it } from 'vitest'
import { toCommission } from './adapters/commission'
import { resetMockDb } from '../test/server'

// The demo-mode mock must answer the commission routes in the shape vendor-api's openapi.json
// declares (CommissionOut, and the 409s of services/commission.py), or the card would work on the
// mock and break on the real service.
const token = mockModuleToken({ id: 'a1', name: 'Admin' }, Math.floor(Date.now() / 1000) + 3600)
const post = async (vendor: string, step: string, body: unknown) => {
  const res = await fetch(`http://mock.test/v1/admin/vendors/${vendor}/commission/${step}`, { method: 'POST', headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' }, body: JSON.stringify(body) })
  return { status: res.status, body: (await res.json()) as Record<string, unknown> }
}
const code = (r: { body: Record<string, unknown> }) => (r.body.error as { code: string }).code

describe('mock vendor-api: POST /v1/admin/vendors/{id}/commission/*', () => {
  // Each test starts from the seed: an approval in one must not change the next one's vendors.
  beforeEach(() => {
    resetMockDb()
  })

  it('answers with the CommissionOut keys, which the adapter reads', async () => {
    const r = await post('v_indigo', 'approve', { proposed_bps: 1000 })
    expect(r.status).toBe(200)
    expect(Object.keys(r.body).sort()).toEqual(['agreed_bps', 'note', 'proposed_bps', 'state', 'updated_at'])
    expect(toCommission(r.body as never)).toMatchObject({ state: 'agreed', agreed_bps: 1000, proposed_bps: null })
  })

  it('approve: 409 commission_changed for another proposal, 409 no_proposal when none waits', async () => {
    const changed = await post('v_rangrez', 'approve', { proposed_bps: 1000 })
    expect([changed.status, code(changed)]).toEqual([409, 'commission_changed'])
    const none = await post('v_kalki', 'approve', { proposed_bps: 1200 })
    expect([none.status, code(none)]).toEqual([409, 'no_proposal'])
  })

  it('approve needs proposed_bps: a body without it is a 422', async () => {
    expect((await post('v_indigo', 'approve', {})).status).toBe(422)
  })

  it('send-back needs a note of 10 to 600 characters, and a waiting proposal', async () => {
    expect((await post('v_indigo', 'send-back', { note: '' })).status).toBe(422)
    expect((await post('v_indigo', 'send-back', { note: 'x'.repeat(601) })).status).toBe(422)
    expect((await post('v_kalki', 'send-back', { note: 'Please propose 12% again.' })).status).toBe(409)
    expect((await post('v_indigo', 'send-back', { note: 'Please propose 8% again.' })).status).toBe(200)
  })

  it('set takes whole basis points from 0 to 4000 and nothing else', async () => {
    for (const bad of [-1, 4001, 12.5, '12', null]) expect((await post('v_kalki', 'set', { commission_bps: bad })).status, String(bad)).toBe(422)
    for (const ok of [0, 4000]) expect((await post('v_kalki', 'set', { commission_bps: ok })).body).toMatchObject({ state: 'agreed', agreed_bps: ok })
  })

  it('set replaces a waiting proposal; a rejected application has no rate to agree (409 vendor_not_eligible)', async () => {
    expect((await post('v_rangrez', 'set', { commission_bps: 1300 })).body).toMatchObject({ state: 'agreed', agreed_bps: 1300, proposed_bps: null })
    expect(code(await post('v_quick', 'set', { commission_bps: 1300 }))).toBe('vendor_not_eligible')
  })

  it('needs a token, and an unknown vendor is a 404', async () => {
    expect((await fetch('http://mock.test/v1/admin/vendors/v_kalki/commission/set', { method: 'POST' })).status).toBe(401)
    expect((await post('nope', 'set', { commission_bps: 1000 })).status).toBe(404)
  })
})
