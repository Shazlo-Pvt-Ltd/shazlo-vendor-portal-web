# vendor-admin

React + TypeScript vendor review module, loaded inside a Shazlo-One iframe. Screens follow the Penpot
wireframes A-04 to A-10 (page **02 · Shazlo-One Admin**): review queue, product review and send back,
brand page review, vendors, vendor applications and publishing status.

It accepts auth only through postMessage from the Shazlo-One origin (`src/app/shell.tsx`,
[ADR 0001](../../docs/adr/0001-iframe-postmessage-protocol.md)), keeps the token in memory, and serves
`Content-Security-Policy: frame-ancestors <shell origin>`. Production builds fail unless
`VITE_SHELL_ORIGIN` is an exact origin.

```sh
npm run dev --workspace @shazlo/vendor-admin     # http://localhost:5175 (development preview)
VITE_SHELL_ORIGIN=https://one.shazlo.store npm run build --workspace @shazlo/vendor-admin
```

Opened directly in development, the module shows a preview banner and uses a sample vendor_reviewer;
in production it shows "Open this from Shazlo One". vendor-api admin endpoints are mocked in `src/api`.
