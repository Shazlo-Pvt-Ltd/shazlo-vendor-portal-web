import { readFileSync } from 'node:fs'
import { URL } from 'node:url'
import { getResponse } from 'msw'
import { describe, expect, it } from 'vitest'
import { createMockVendorApi, createVendorApiHandlers, mockModuleToken } from '../../packages/mock-vendor-api/src/index.ts'
import { badgeOf, parseSummary } from '../../packages/shell-protocol/src/summary.ts'

// ADR 0011: Shazlo One reads every module's summary with one schema (packages/shell-protocol) and
// shows nothing for a summary it cannot read. vendor-api writes the Vendors module's summary in
// Python; these checks keep the two sides in step, so a change on one side fails here, not as an
// empty card in production.

const openapi = JSON.parse(readFileSync(new URL('../../services/vendor-api/openapi.admin.json', import.meta.url), 'utf8'))
const schemas = openapi.components.schemas

describe('vendor-api GET /v1/admin/module-summary', () => {
  it('is served by the admin app and answers ModuleSummaryOut', () => {
    const route = openapi.paths['/v1/admin/module-summary']?.get
    expect(route).toBeDefined()
    expect(route.responses['200'].content['application/json'].schema).toEqual({ $ref: '#/components/schemas/ModuleSummaryOut' })
  })

  it('documents an example the shell reads as it is', () => {
    const [example] = schemas.ModuleSummaryOut.examples
    const parsed = parseSummary(example)
    expect(parsed).not.toBeNull()
    expect(badgeOf(parsed)).toEqual(example.badge)
    expect(parsed.sections.map((s) => s.figures.length)).toEqual(example.sections.map((s) => s.figures.length))
    expect(parsed.activity.items).toHaveLength(example.activity.items.length)
  })

  it('declares the same fields the shell schema knows', () => {
    const fields = (name) => Object.keys(schemas[name].properties).sort()
    expect(fields('ModuleSummaryOut')).toEqual(['activity', 'badge', 'sections', 'v'])
    expect(fields('SummarySectionOut')).toEqual(['action', 'alert', 'figures', 'icon', 'title'])
    expect(fields('SummaryFigureOut')).toEqual(['hint', 'label', 'path', 'unit', 'value'])
    expect(fields('ActivityItemOut')).toEqual(['actor_id', 'at', 'id', 'path', 'status', 'subtitle', 'title'])
    expect(schemas.SummaryFigureOut.properties.unit.enum).toEqual(['count', 'minutes'])
    expect(schemas.ActivityStatusOut.properties.tone.enum).toEqual(['positive', 'attention'])
  })
})

describe('the mock vendor-api (browser demo)', () => {
  it('answers a summary the shell reads', async () => {
    const db = createMockVendorApi()
    const token = mockModuleToken({ id: '00000000-0000-4000-8000-000000000001', name: 'Naman Sinha' }, Math.floor(db.now().getTime() / 1000) + 300)
    const request = new globalThis.Request('http://localhost:5194/v1/admin/module-summary', { headers: { Authorization: `Bearer ${token}` } })
    const response = await getResponse(createVendorApiHandlers(() => db), request)
    expect(response?.status).toBe(200)
    const parsed = parseSummary(await response.json())
    expect(parsed).not.toBeNull()
    expect(parsed.sections.map((s) => s.title)).toEqual(['Vendors', 'Publishing to the app'])
    expect(parsed.activity.items.length).toBeGreaterThan(0)
  })
})
