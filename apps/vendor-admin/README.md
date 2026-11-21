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
| Commission | Per brand, never a default rate ([vendor requirements §6](../../docs/ui-plan/vendor-requirements-and-phone-ux.md)). A-09's Commission card approves a proposal, sends it back with a note, or sets the rate (`/vendors/{id}/commission/approve`, `send-back`, `set`); approve and send back carry the `proposed_bps` the reviewer saw, and a proposal the brand changed since is refused (`409 proposal_changed`) and the card reloads. Wherever the page is one column (below 900 px) the card comes before the application. Approving an application asks for the rate, starting from the brand's proposal. A-08's "Rate to review" tab is `?commission=proposed`, linked from the queue |
| Tests | `npx vitest run --project vendor-admin`, with a fake shell (`src/test/render.tsx`). In a real browser inside Shazlo One, at phone, tablet and desktop widths: `npm run e2e -w @shazlo/vendor-admin` (starts or reuses the three dev servers; `PW_CHANNEL=msedge` or `chrome` uses an installed browser if Playwright's own is not downloaded) |
