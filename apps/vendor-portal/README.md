# vendor-portal

React + TypeScript (Vite) app where vendors sign up, personalise their brand page and list products.
Screens follow the Penpot wireframes V-01 to V-09 (page **01 · Vendor Portal**), including the 390 px
layouts V-04m to V-07m.

| Route | Wireframe |
|---|---|
| `/sign-in`, `/apply`, `/set-password?token=…` | V-01 Sign in, V-02 Apply to sell, V-03 Set password |
| `/` | V-04 Overview |
| `/brand` | V-05 Brand page editor |
| `/products`, `/products/:id`, `/products/new` | V-06 Products, V-07 Product editor |
| `/products/import` | V-08 Bulk import |
| `/review` | V-09 Review status |

```sh
npm run dev --workspace @shazlo/vendor-portal     # http://localhost:5173
npm test -- --project vendor-portal
```

vendor-api is still in Phase 2, so every call goes to the in-memory mock in `src/api/mock.ts`,
which follows the planned contract and uses the wireframe data (Kalki Studio). Sign in with
`kiran@kalkistudio.in` / `kalki-studio-2026`. Each mock method is swapped for an HTTP call
(`VITE_VENDOR_API_URL`) when its endpoint ships.

The sign-in footer links to the storefront's Seller terms, Privacy and Commission & payouts pages
(`/pages/...`). They default to `https://shazlo.store`; set `VITE_STOREFRONT_URL` to point them at
another storefront.

Shared components and tokens come from `@shazlo/ui/components` (built from the Penpot kit).
