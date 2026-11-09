# shazlo-one

React + TypeScript admin shell: sign-in, module navigation and the iframe host for each service's
admin UI. Screens follow the Penpot wireframes A-01 to A-03 and A-11 (page **02 · Shazlo-One Admin**).

- `src/app/registry.ts`: the module registry (id, URL, exact origin, required roles). The nav only shows
  modules the admin's roles allow.
- `src/app/ModuleHost.tsx`: hosts a module in a sandboxed iframe and runs the
  [ADR 0001](../../docs/adr/0001-iframe-postmessage-protocol.md) handshake from `@shazlo/shell-protocol`:
  listener before `src`, `ready` → `auth`, token refresh at 80% of its lifetime, `title`/`toast`/`logout`,
  and the A-03 error panel after a 10 s timeout (Retry reloads only the iframe; "unavailable" after 3).

```sh
npm run dev --workspace @shazlo/shazlo-one       # http://localhost:5174
npm run dev --workspace @shazlo/vendor-admin     # http://localhost:5175, framed at /vendors
```

identity-api calls go to the in-memory mock in `src/api/mock.ts` for now. Sign in with
`priya@shazlo.store` (vendor_reviewer) or `naman@shazlo.store` (super_admin), password `shazlo-one-2026`.
Set `VITE_VENDOR_ADMIN_URL` to point the Vendors module at another origin.
