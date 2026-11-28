import { describe, expect, it } from 'vitest'
import {
  actorIds,
  badgeOf,
  isModulePath,
  manifestUrl,
  parseManifest,
  parseModuleToShell,
  parseRegistry,
  parseShellToModule,
  parseSummary,
  registryCsp,
  type RegistryInput,
} from './index'
import { fakeModule } from './testing'

// ADR 0011: the shell's registry, a module's manifest and a module backend's summary.

const vendors: RegistryInput = {
  id: 'vendor-admin',
  fallbackTitle: 'Vendors',
  basePath: '/vendors',
  url: 'https://vendor-admin.shazlo.store/',
  roles: ['vendor_reviewer', 'super_admin'],
  audience: 'vendor-api',
  summaryUrl: 'https://vendor-admin-api.shazlo.store/v1/admin/summary',
}
const marketing: RegistryInput = {
  id: 'marketing',
  fallbackTitle: 'Marketing',
  basePath: '/marketing',
  url: 'https://marketing.shazlo.store/',
  roles: ['marketing_editor'],
  audience: 'marketing-api',
}

describe('module paths', () => {
  it.each(['/queue', '/review/product/9b2f', '/publishing?status=failed', '/vendors/v_1#history', '/'])('accepts %s', (path) => {
    expect(isModulePath(path)).toBe(true)
  })

  it.each([
    '',
    'queue',
    '//evil.test',
    '/\\evil.test',
    '/../admins',
    '/queue/../../admins',
    '/./queue',
    '/%2e%2e/admins',
    '/queue x',
    '/queue\n',
    'javascript:alert(1)',
    'https://evil.test/',
    `/${'a'.repeat(600)}`,
  ])('refuses %j', (path) => {
    expect(isModulePath(path)).toBe(false)
  })

  it('guards navigate and title messages too', () => {
    const message = (type: string, payload: unknown) => ({ protocol: 'shazlo-one', v: 1, type, id: '00000000-0000-4000-8000-000000000001', sentAt: 1, payload })
    const accepted = { acceptedVersions: [1] }
    expect(parseShellToModule(message('navigate', { path: '/\\evil.test' }), accepted).ok).toBe(false)
    expect(parseModuleToShell(message('title', { path: '/../admins', title: 'Admins' }), accepted).ok).toBe(false)
    expect(parseShellToModule(message('navigate', { path: '/queue?sort=oldest' }), accepted).ok).toBe(true)
  })
})

describe('parseRegistry', () => {
  it('derives each exact origin and keeps the trusted fields', () => {
    const [entry] = parseRegistry([vendors], 'production')
    expect(entry).toMatchObject({ id: 'vendor-admin', origin: 'https://vendor-admin.shazlo.store', audience: 'vendor-api', roles: ['vendor_reviewer', 'super_admin'] })
  })

  it('allows plain http only for localhost, and only in development', () => {
    const lan = { ...vendors, url: 'http://192.168.1.20:5193/', summaryUrl: 'http://vendor-api.lan/v1/admin/summary' }
    expect(() => parseRegistry([lan], 'development')).toThrow(/url may use plain http only for localhost[\s\S]*summaryUrl may use plain http only for localhost/)
  })

  it('allows plain http in development only', () => {
    const local = { ...vendors, url: 'http://localhost:5193/', summaryUrl: 'http://localhost:8004/v1/admin/summary' }
    expect(parseRegistry([local], 'development')[0]?.origin).toBe('http://localhost:5193')
    expect(() => parseRegistry([local], 'preview')).toThrow(/https outside development/)
    expect(() => parseRegistry([local], 'production')).toThrow(/url must be https[\s\S]*summaryUrl must be https/)
  })

  it.each([
    ['a wildcard', { url: 'https://*.shazlo.store/' }, /wildcards/],
    ['credentials', { url: 'https://user:pw@vendor-admin.shazlo.store/' }, /credentials/],
    ['a query', { url: 'https://vendor-admin.shazlo.store/?next=1' }, /without wildcards or patterns/],
    ['a fragment', { url: 'https://vendor-admin.shazlo.store/#x' }, /query or a fragment/],
    ['a path', { url: 'https://vendor-admin.shazlo.store/app/' }, /origin with no path/],
    ['a pattern', { url: 'https://vendor-admin.shazlo.(store|com)/' }, /without wildcards or patterns/],
    // The URL parser keeps these in a host; each would end the CSP directive the origin is written into.
    ['a semicolon in the host', { url: 'https://vendor-admin.shazlo.store;script-src*/' }, /letters, digits, dots and hyphens|wildcards/],
    ['a semicolon in the host, no pattern characters', { url: 'https://a;b.shazlo.store/' }, /letters, digits, dots and hyphens/],
    ['a comma in the host', { url: 'https://a,b.shazlo.store/' }, /letters, digits, dots and hyphens/],
    ['a quote in the host', { url: "https://a'b.shazlo.store/" }, /letters, digits, dots and hyphens/],
    ['an IPv6 host', { url: 'https://[::1]/' }, /letters, digits, dots and hyphens|patterns/],
    ['a bad summary host', { summaryUrl: 'https://a;b.shazlo.store/v1/summary' }, /summaryUrl must have a host/],
    ['not a URL', { url: 'vendor-admin' }, /not a URL/],
    ['another scheme', { url: 'ftp://vendor-admin.shazlo.store/' }, /http\(s\)/],
    ['a shell route', { basePath: '/admins' }, /belongs to the shell/],
    ['identity-api as audience', { audience: 'identity-api' }, /cannot be identity-api/],
    ['no roles', { roles: [] }, /roles/],
    ['a nested base path', { basePath: '/vendors/x' }, /one segment/],
    ['an unknown field', { origin: 'https://other.test' }, /registry is not valid/],
  ] as const)('refuses %s', (_, change, message) => {
    expect(() => parseRegistry([{ ...vendors, ...change }], 'production')).toThrow(message)
  })

  it('refuses two modules with the same id, origin or base path, listing every problem', () => {
    const twin = { ...marketing, id: 'vendor-admin', url: vendors.url, basePath: '/vendors' }
    expect(() => parseRegistry([vendors, twin], 'production')).toThrow(/same id[\s\S]*same origin[\s\S]*same basePath/)
  })

  it('builds the CSP the shell needs: module frames, and their manifests and summaries', () => {
    const entries = parseRegistry([vendors, marketing], 'production')
    expect(registryCsp(entries)).toEqual({
      frameSrc: ['https://vendor-admin.shazlo.store', 'https://marketing.shazlo.store'],
      connectSrc: ['https://vendor-admin.shazlo.store', 'https://marketing.shazlo.store', 'https://vendor-admin-api.shazlo.store'],
    })
  })
})

describe('parseManifest', () => {
  const manifest = {
    v: 1,
    id: 'vendor-admin',
    title: 'Vendors',
    icon: 'store',
    home: { label: 'Dashboard', path: '/dashboard', icon: 'layout-dashboard' },
    links: [
      { label: 'Review queue', path: '/queue', icon: 'inbox', also: ['/review'] },
      { label: 'All vendors', path: '/vendors', icon: 'building-2' },
    ],
  }

  it('reads a module manifest from its fixed path', () => {
    expect(manifestUrl('https://vendor-admin.shazlo.store/app/')).toBe('https://vendor-admin.shazlo.store/shazlo-module.json')
    expect(parseManifest(manifest, 'vendor-admin')).toMatchObject({ title: 'Vendors', links: [{ also: ['/review'] }, {}] })
  })

  it('falls back to the box icon for a name it does not know', () => {
    expect(parseManifest({ ...manifest, icon: 'rocket-ship' }, 'vendor-admin')?.icon).toBe('box')
  })

  it("is null for another module's manifest, a hostile path or a wrong version", () => {
    expect(parseManifest(manifest, 'marketing')).toBeNull()
    expect(parseManifest({ ...manifest, home: { ...manifest.home, path: '//evil.test' } }, 'vendor-admin')).toBeNull()
    expect(parseManifest({ ...manifest, links: [{ label: 'Admins', path: '/../admins', icon: 'users' }] }, 'vendor-admin')).toBeNull()
    expect(parseManifest({ ...manifest, v: 2 }, 'vendor-admin')).toBeNull()
    expect(parseManifest('<html>', 'vendor-admin')).toBeNull()
  })
})

describe('parseSummary and badgeOf', () => {
  const summary = {
    v: 1,
    badge: { count: 14, label: '14 waiting' },
    sections: [
      {
        title: 'Vendors',
        action: { label: 'Open the queue', path: '/queue' },
        figures: [
          { label: 'Waiting', value: 14, path: '/queue' },
          { label: 'Median wait', value: 95, unit: 'minutes' },
          { label: 'Decided today', value: null },
        ],
      },
      {
        title: 'Publishing to the app',
        alert: { tone: 'error', text: '2 events failed', action: { label: 'See them', path: '/publishing?status=failed' } },
        figures: [{ label: 'Failed', value: 2, path: '/publishing?status=failed' }],
      },
    ],
    // A newer backend's field: dropped, not refused.
    generated_at: '2026-11-27T10:00:00Z',
  }

  // The summary with its first figure changed.
  function withFirstFigure(change: Record<string, unknown>) {
    const [first, ...rest] = summary.sections
    const [figure, ...others] = first?.figures ?? []
    return { ...summary, sections: [{ ...first, figures: [{ ...figure, ...change }, ...others] }, ...rest] }
  }

  it('reads a summary and defaults a figure to a count', () => {
    const parsed = parseSummary(summary)
    expect(parsed?.sections[0]?.figures[0]).toEqual({ label: 'Waiting', value: 14, unit: 'count', path: '/queue' })
    expect(parsed && 'generated_at' in parsed).toBe(false)
    expect(badgeOf(parsed)).toEqual({ count: 14, label: '14 waiting' })
  })

  it('is null for a figure that links out of the module, a negative count or too many figures', () => {
    expect(parseSummary(withFirstFigure({ path: 'https://evil.test/' }))).toBeNull()
    expect(parseSummary(withFirstFigure({ value: -1 }))).toBeNull()
    const five = Array.from({ length: 5 }, (_, n) => ({ label: `F${n}`, value: n, path: '/queue' }))
    expect(parseSummary({ ...summary, sections: [{ ...summary.sections[0], figures: five }] })).toBeNull()
  })

  it('never turns a missing summary into a 0 badge', () => {
    expect(badgeOf(null)).toBeNull() // the request failed, timed out or was not valid
    expect(badgeOf(undefined)).toBeNull() // still loading
    expect(badgeOf(parseSummary({ ...summary, badge: null }))).toBeNull()
    expect(badgeOf(parseSummary({ ...summary, badge: { count: 0, label: 'Nothing waiting' } }))).toBeNull()
  })
})

describe('a summary from a FastAPI backend, and its activity', () => {
  const naman = '00000000-0000-4000-8000-000000000001'
  const priya = '00000000-0000-4000-8000-000000000002'
  // FastAPI sends null for every optional field it leaves empty.
  const fromPython = {
    v: 1,
    badge: { count: 3, label: '3 waiting' },
    sections: [
      {
        title: 'Vendors',
        icon: 'store',
        action: null,
        alert: null,
        figures: [{ label: 'Waiting', value: 3, unit: 'count', hint: null, path: null }],
      },
    ],
    activity: {
      title: 'Recent decisions',
      icon: 'a-newer-icon',
      empty: { title: 'No decisions yet', body: null },
      items: [
        { id: 'a', title: 'Kurta', subtitle: 'Kalki Studio · Product', status: { tone: 'positive', label: 'Approved' }, at: '2026-11-27T10:00:00Z', actor_id: priya, path: '/queue' },
        { id: 'b', title: 'Dupatta', subtitle: null, status: { tone: 'attention', label: 'Sent back' }, at: '2026-11-27T15:30:00+05:30', actor_id: priya, path: null },
        { id: 'c', title: 'Brand page', status: { tone: 'positive', label: 'Approved' }, at: '2026-11-26T10:00:00.123456+00:00', actor_id: naman },
        { id: 'd', title: 'Commission', status: { tone: 'attention', label: 'Sent back' }, at: '2026-11-26T09:00:00Z', actor_id: null },
      ],
    },
  }

  it('reads nulls as missing, and an unknown icon as the box', () => {
    const parsed = parseSummary(fromPython)
    expect(parsed?.sections[0]).toMatchObject({ title: 'Vendors', icon: 'store', action: null, alert: null })
    expect(parsed?.activity?.icon).toBe('box')
    expect(parsed?.activity?.items).toHaveLength(4)
  })

  it('reads an actor that is not an id as unknown, and keeps the rest', () => {
    const item = fromPython.activity.items[0]!
    const parsed = parseSummary({ ...fromPython, activity: { ...fromPython.activity, items: [{ ...item, actor_id: 'a_priya' }] } })
    expect(parsed?.activity?.items[0]?.actor_id).toBeNull()
    expect(parsed?.activity?.items[0]?.title).toBe('Kurta')
    expect(actorIds(parsed)).toEqual([])
  })

  it('names each admin behind the activity once', () => {
    expect(actorIds(parseSummary(fromPython))).toEqual([priya, naman])
    expect(actorIds(null)).toEqual([])
    expect(actorIds(parseSummary({ ...fromPython, activity: null }))).toEqual([])
  })

  it('is null for activity that links out of the module or has a time without a zone', () => {
    const item = fromPython.activity.items[0]!
    const withItem = (change: Record<string, unknown>) => ({ ...fromPython, activity: { ...fromPython.activity, items: [{ ...item, ...change }] } })
    expect(parseSummary(withItem({}))).not.toBeNull()
    expect(parseSummary(withItem({ path: '//evil.test/' }))).toBeNull()
    expect(parseSummary(withItem({ at: '2026-11-27T10:00:00' }))).toBeNull()
    expect(parseSummary(withItem({ status: { tone: 'celebrate', label: 'Approved' } }))).toBeNull()
    const eleven = Array.from({ length: 11 }, (_, n) => ({ ...item, id: `i${n}` }))
    expect(parseSummary({ ...fromPython, activity: { ...fromPython.activity, items: eleven } })).toBeNull()
  })
})

describe('fakeModule (shell tests)', () => {
  const entry: RegistryInput = { id: 'catalogue', fallbackTitle: 'Catalogue', basePath: '/catalogue', url: 'https://catalogue.test/', roles: ['super_admin'], audience: 'catalogue-api', summaryUrl: 'https://catalogue-api.test/v1/summary' }
  const summary = { v: 1 as const, badge: { count: 2, label: '2 waiting' }, sections: [] }

  async function call(handlers: ReturnType<ReturnType<typeof fakeModule>['handlers']>, request: Request) {
    for (const handler of handlers) {
      const result = await handler.run({ request, requestId: crypto.randomUUID() })
      if (result?.response) return result.response
    }
    return null
  }

  it('serves its manifest without a token, and its summary only with one', async () => {
    const fake = fakeModule(entry, { manifest: { links: [{ label: 'Queue', path: '/queue', icon: 'inbox' }] }, summary })
    expect(fake.entry.origin).toBe('https://catalogue.test')
    expect(fake.manifestUrl).toBe('https://catalogue.test/shazlo-module.json')
    const manifest = await call(fake.handlers(), new Request(fake.manifestUrl))
    expect(parseManifest(await manifest?.json(), 'catalogue')?.links.map((l) => l.path)).toEqual(['/queue'])
    expect((await call(fake.handlers(), new Request(entry.summaryUrl!)))?.status).toBe(401)
    const read = await call(fake.handlers(), new Request(entry.summaryUrl!, { headers: { Authorization: 'Bearer t' } }))
    expect(badgeOf(parseSummary(await read?.json()))).toEqual({ count: 2, label: '2 waiting' })
  })

  it('refuses a summary or manifest that the shell would not read', () => {
    expect(() => fakeModule(entry, { summary: { ...summary, badge: { count: -1, label: 'x' } } })).toThrow()
    expect(() => fakeModule(entry, { manifest: { home: { label: 'Home', path: 'https://evil.test/', icon: 'box' } } })).toThrow()
  })
})
