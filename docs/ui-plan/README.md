# Seller portal UI spec

The decisions behind `apps/vendor-portal` (roadmap Phase 5). They come from the picks on the
[options board](https://claude.ai/artifact/Woy3S3CzexCtwuJ2Pp8jP8) (source: `seller-portal-choices.html`),
made on 9 Nov 2026 against the Penpot wireframes V-01 to V-09 and their 390 px versions.
Where this spec and a wireframe disagree, this spec wins.

## Foundations

| Area | Decision |
|---|---|
| Desktop navigation | Fixed 248 px sidebar: store switcher, five sections with counts, settings group, user footer |
| Mobile navigation (< 900 px) | Bottom tab bar: Overview, Products, Add, Review, More |
| Headings | Editorial: Bodoni Moda page titles at 48 px (32 px on phones), card titles 18 px |
| Handwritten Schoolbell | Empty states and setup tips only; never in labels, buttons or data |
| Surfaces | Off-white cards with a 1 px line on the cream canvas; no shadows on cards |
| Main action | Amber fill with wine text; one per view |
| Status | Tinted pill with icon and word |
| Icons | Lucide, 1.5 px stroke, `currentColor` |
| Table rows | Comfortable: 56 px with a 40 px photo |
| Empty states | A small brown line drawing, one line of copy, one action |
| Loading | Skeletons shaped like the content |
| Motion | 150–250 ms ease-out fades with a 4 px rise for new items; drawers slide at 200 ms; gentler under reduced motion |
| Confirmations | Snackbar for small things (saved, copied); banner for review outcomes (submitted, sent back) |
| Theme | Light only for v1; colours come only from `@shazlo/ui` tokens |

## Screens

| Screen | Decision |
|---|---|
| V-01 Sign in | Split: form on the left, "why sell on Shazlo" points on a cream panel on the right (panel hidden on phones) |
| V-02 Apply to sell | Three steps (brand, contact, catalogue), each saved |
| V-03 Set password | Rules that tick off as you type |
| V-04 Overview | Sent-back banner, stat figures, recent decisions, brand card |
| V-04 Setup checklist | Slim progress banner across the top of every page until done or closed |
| V-05 Brand page | Sticky phone preview beside the form with a Draft / Live switch; "Changed" tag on edited fields |
| V-06 Products | Table with status tabs and dropdown filters; navy bulk-action bar above the table |
| V-06 on phones | A card per product |
| V-07 Product editor | Long page with a side column; named photo slots (Front, Back, Fabric close-up, extras); size chips with − / + stock steppers; "You receive" card next to price |
| Drafts | Autosave a second after typing stops, with "Saved · 2 min ago"; submitting stays a click |
| V-08 Bulk import | Wizard in a dialog over Products; error report as a table of rows to fix |
| V-09 Review status | Waiting and decided lists; reviewer reasons quoted with "Fix and resubmit" |
| Notifications | Bell in the top bar opening a short list |

## Engineering

| Area | Decision |
|---|---|
| Before vendor-api exists | Mock Service Worker handlers that follow `docs/05-api-design.md` §5; each is deleted when its endpoint ships |
| Forms | React Hook Form + Zod; one schema per form gives both validation and types |
| Tables | TanStack Table for logic, MUI Table for markup |
| API client | `openapi-fetch`, typed from an OpenAPI contract (`apps/vendor-portal/openapi/vendor-portal.yaml` until vendor-api serves its own) |
| Component preview | The existing `packages/ui` demo page grows with each shared component |
| Visual regression | Playwright screenshots at 1440 px and 390 px in CI |
| Shared components | `packages/ui` from the start; screens stay in the app |
| Language | English, with each screen's copy in one module so Hindi can be added later |

## Rules every PR follows

From the design-skill research (jakubkrehel/skills, Emil Kowalski's skills, Impeccable's detector, Taste Skill's app-screen notes):

1. Flat fills. No gradients, glows, or coloured stripes down the side of cards and banners.
2. Stat figures are type: number, label, baseline. No icon circles or sparklines.
3. Status is never colour alone.
4. Prices and counts are right-aligned and formatted `en-IN` (₹2,499; ₹1,25,000). A missing value is a dash; zero is printed.
5. Every list, table and panel has loading, empty, error and partial states. A disabled control says why.
6. No synthetic bold: Ovo is 400 only.
7. Body text 60–75 characters wide.
8. Radii 6 / 8 / 12; borders for structure, not shadows.
9. Motion uses named properties only, never on sort, tab switch or typing; hover styles only where hover exists.
10. Visible focus ring; labels, not placeholders; errors linked to their field; focus moves to the first error.
11. 44 px touch targets and 16 px inputs on phones; layouts hold at 320 px and 200% zoom.
12. Buttons say what they do. The same word means the same thing everywhere.
13. Edit inline or in a drawer before reaching for a modal (the bulk-import wizard is the chosen exception).
14. Test with worst-case data: long names, 0 and 1,000 products, long import errors, Devanagari.

## Build order

0. Groundwork: scaffold, providers, routes, mock API, API client, test harness
1. App shell (desktop and mobile)
2. V-01 to V-03 and route guards
3. V-04 and V-09
4. V-05
5. V-06 and V-07
6. V-08
7. Polish and audit; swap remaining mocks for real endpoints
