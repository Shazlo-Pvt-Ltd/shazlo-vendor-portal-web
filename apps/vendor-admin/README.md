# vendor-admin

The Vendors module of Shazlo One (roadmap Phase 7): the review queue, product and brand-page review with
send back, vendor applications and management, and publishing status. It only runs inside Shazlo One:
`frame-ancestors` names the shell origin, and it gets its token only through the ADR 0001 postMessage
protocol. Opened on its own, it explains that and links to Shazlo One.

Run it with the shell: see [apps/shazlo-one](../shazlo-one/README.md).

| Area | Where |
|---|---|
| Contract | `src/api/schema.d.ts` is generated from `services/vendor-api/openapi.json` (`npm run api:generate`; CI runs `api:check`), and `src/api/proposed.d.ts` from `openapi/proposed.yaml`, what vendor-api still lacks (`api:proposed`, `api:proposed:check`); `src/api/client.ts` merges them. Until #294 to #298 move each area to `/v1/admin/*`, the screens call the hand-written `/api/v1/admin/*` in `openapi/vendor-admin.yaml` (`src/api/legacy.d.ts`, `api:legacy`), and their types are the view models in `src/api/model.ts` |
| Errors | `src/api/http.ts` reads vendor-api's `{error: {code, message, request_id, details?}}`; a 422's `details` become field errors, and the 409s `stale_review`, `review_already_decided`, `invalid_status_transition`, `commission_changed` and `no_proposal` use the screens' wording. Other codes show the server's message |
| Runtime | `src/runtime/runtime.tsx`: `ready` on load, token in memory, `token:request` on 401, follows `navigate`, `useModuleTitle` for every screen, `toast` to the shell |
| Mock | `packages/mock-vendor-api`: MSW handlers in tests, a local HTTP server in the browser so shell and module share one state |
| Screens | A-04 review queue, A-05 product review, A-06 send back, A-07 brand page review, A-08 vendors, A-09 vendor detail, A-10 publishing |
| Commission | Per brand, never a default rate ([vendor requirements §6](../../docs/ui-plan/vendor-requirements-and-phone-ux.md)). A-09's Commission card approves a proposal, sends it back with a note, or sets the rate (`/vendors/{id}/commission/approve`, `send-back`, `set`); approving an application asks for the rate, starting from the brand's proposal. A-08's "Rate to review" tab is `?commission=proposed`, linked from the queue |
| Tests | `npx vitest run --project vendor-admin`, with a fake shell (`src/test/render.tsx`) |
