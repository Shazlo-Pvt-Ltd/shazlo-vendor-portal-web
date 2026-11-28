import { http, HttpResponse, type HttpHandler } from 'msw'
import { manifestUrl, moduleManifestSchema, type ModuleManifest } from './manifest'
import { parseRegistry, type RegistryEntry, type RegistryInput } from './registry'
import { moduleSummarySchema, type ModuleSummary } from './summary'

// A stand-in module for shell tests (ADR 0011): its registry entry, the manifest its web app
// serves, the summary its backend serves, and MSW handlers for both. The shell under test then
// knows nothing about any real module.

export type FakeModule = {
  entry: RegistryEntry
  manifest: ModuleManifest
  manifestUrl: string
  summary: ModuleSummary | null
  // GET <module>/shazlo-module.json and GET <summaryUrl> (which needs a bearer token).
  handlers: () => HttpHandler[]
}

// `input` may be a parsed entry (the shell's own registry): its derived origin is dropped and derived again.
export function fakeModule(input: RegistryInput | RegistryEntry, { manifest, summary = null }: { manifest?: Partial<ModuleManifest>; summary?: ModuleSummary | null } = {}): FakeModule {
  const { origin: _origin, ...raw } = input as RegistryEntry
  const [entry] = parseRegistry([raw], 'development')
  const full = moduleManifestSchema.parse({
    v: 1,
    id: input.id,
    title: input.fallbackTitle,
    icon: 'box',
    home: { label: 'Overview', path: '/', icon: 'layout-dashboard' },
    links: [],
    ...manifest,
  })
  const checked = summary ? moduleSummarySchema.parse(summary) : null
  const url = manifestUrl(entry!.url)
  return {
    entry: entry!,
    manifest: full,
    manifestUrl: url,
    summary: checked,
    handlers: () => [
      http.get(url, () => HttpResponse.json(full)),
      ...(entry!.summaryUrl
        ? [
            http.get(entry!.summaryUrl, ({ request }) => {
              if (!request.headers.get('Authorization')?.startsWith('Bearer ')) {
                return HttpResponse.json({ error: { code: 'unauthorized', message: 'Sign in again.', request_id: 'fake' } }, { status: 401 })
              }
              return checked ? HttpResponse.json(checked) : HttpResponse.json({ error: { code: 'not_found', message: 'Not found', request_id: 'fake' } }, { status: 404 })
            }),
          ]
        : []),
    ],
  }
}
