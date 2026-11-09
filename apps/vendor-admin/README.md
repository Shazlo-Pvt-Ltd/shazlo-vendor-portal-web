# vendor-admin

The Vendors module of Shazlo One (roadmap Phase 7): the review queue, product and brand-page review with
send back, vendor applications and management, and publishing status. It only runs inside Shazlo One:
`frame-ancestors` names the shell origin, and it gets its token only through the ADR 0001 postMessage
protocol. Opened on its own, it explains that and links to Shazlo One.

Run it with the shell: see [apps/shazlo-one](../shazlo-one/README.md).

| Area | Where |
|---|---|
| Contract | `openapi/vendor-admin.yaml`: `/api/v1/admin/*` from docs/05 §6; routes marked `x-proposal` need agreeing with vendor-api |
| Runtime | `src/runtime/runtime.tsx`: `ready` on load, token in memory, `token:request` on 401, follows `navigate`, `useModuleTitle` for every screen, `toast` to the shell |
| Mock | `packages/mock-vendor-api`: MSW handlers in tests, a local HTTP server in the browser so shell and module share one state |
| Screens | A-04 review queue, A-05 product review, A-06 send back, A-07 brand page review, A-08 vendors, A-09 vendor detail, A-10 publishing |
| Tests | `npx vitest run --project vendor-admin`, with a fake shell (`src/test/render.tsx`) |
