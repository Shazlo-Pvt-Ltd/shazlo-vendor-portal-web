# Vendor requirements and a calmer phone experience (Build 2)

Status: decided 19 Nov 2026. Build 2 (`naman/penpot-ui-2`) is the chosen design. Desktop keeps the Build 2
layout. Phones, iPads and the home-screen web app keep the Build 2 look but get simpler: fewer things on
each screen, one question at a time, nothing flashing for attention.

Inputs:
- *Shazlo Vendor Portal Requirements* (PDF, Nov 2026): what we must collect from vendors and what the portal must have.
- Web research on mobile forms, calm UI, adaptive layouts and how Indian seller apps work (sources at the end).

## 1. What changes, in one list

1. **Sign-up collects the brand details the app needs** (PDF §1), one short topic per page, saved as you go,
   ending with a "Check your answers" page. Required fields are enforced; optional ones say "(optional)".
2. **Store details** replaces the "Store settings" placeholder: the same details, editable after approval.
   A product cannot be sent for review until the store details are complete.
3. **Commission is per brand, never a fixed 15%.** The brand may propose a rate when it signs up or later;
   Shazlo approves it or sends it back with a note, or enters an agreed rate itself.
4. **Product form follows PDF §2**: 4 named product photos + 5 try-on photos, gender, product type, main
   colour + up to 2 other colours, material, description, sizes with stock, selling price, optional MRP and an
   optional size chart saved per product type. Product codes stay automatic and are never called "SKU".
5. **Bulk import uses the PDF §4 columns** (`sizes_stock` like `S:4, M:6`), with photos matched by product name.
6. **Phone and tablet navigation changes** (below), and a quieter Home.
7. **Admin (Shazlo One › Vendors)** shows the new brand and product details, and handles commission proposals.

## 2. Research in brief

What the evidence says, and what we do with it:

| Finding | Source | What we do |
|---|---|---|
| One thing per page; autosave; a "Check your answers" page before sending | GOV.UK form structure, check answers; NN/g wizards | Sign-up and store details are short pages with *Step x of y* in plain text |
| Check answers when the person taps Continue, not while typing or on leaving a field | GOV.UK validation | Forms validate on Continue / Save / Submit; an error clears as soon as it is fixed |
| Mark optional fields with "(optional)"; never asterisks | GOV.UK question pages | No `required` asterisks anywhere; optional fields say so |
| Radios or chips beat dropdowns when there are few options | GOV.UK select | Gender, delivery choice, returns, colours, product type use chips/radios |
| `inputmode="numeric"` (not `type="number"`) for price, stock, PIN, account number; real `autocomplete` values | GOV.UK text input; web.dev forms | Applied to every numeric and contact field |
| Tab bars hold 3–5 *places*, never actions; avoid a catch-all "More" | Apple HIG tab bars; Android nav patterns | Phone tabs become Home · Products · Store · Account; "Add product" is a button on Home and Products |
| Choose navigation by window width: bottom bar under 600 px, rail 600–1023, sidebar from 1024 | Android window size classes; Apple HIG layout | iPad portrait and split view get a rail, not a stretched phone layout |
| One accent colour, used only for the main action; yellow on cream fails contrast as text/borders | NN/g colour; WCAG 1.4.3 / 1.4.11 | One yellow button per screen; yellow is a fill behind dark text only |
| Badges only when the person must act; no self-dismissing toasts | Apple HIG; Primer toasts; GOV.UK notification banner | No badge on tabs; the bell shows a dot only for "needs your changes"; success shows in the page |
| Respect reduced motion; no decorative motion | WCAG 2.3.3; MDN | Transitions off under `prefers-reduced-motion` |
| Home-screen web apps need safe-area padding, `dvh`, an in-app Back link, no accidental pull-to-refresh | web.dev PWA app design; Chrome viewport units | Manifest, `viewport-fit=cover`, safe-area insets on bars, Back on every inner page |
| Photo picker without `capture` (keeps the gallery); a separate "Take photo"; shrink before upload; per-photo retry; no drag-only reordering | web.dev media capture; Google NBU; WCAG 2.5.7 | Applied to product and try-on photos |
| Plain words, about a 6th–8th grade reading level; no "SKU", "variant", "QC", "listing" | NN/g lower-literacy users | Copy reviewed; product code shown as "Code" |
| Sellers hate opaque rejections and reasons in spreadsheets | Meesho, Flipkart seller reports | Every send-back reason sits on the field or photo with a "Fix this" link |
| Showing what the seller receives builds trust, but they must keep control of the price | Flipkart settlement-value backlash; Etsy, Shopify | "You receive ₹X after Y% commission" under the price; the brand always sets the price |
| Indian marketplaces (Meesho, Amazon, Flipkart) collect pickup address and bank at sign-up | Seller onboarding guides | Matches the PDF: collected at sign-up, editable later |

## 3. Navigation by width (seller portal)

| Width | Navigation | Content |
|---|---|---|
| under 600 px (phones, iPad ⅓ split) | Bottom tab bar: **Home · Products · Store · Account**, labelled icons, no badges, safe-area padding | One column, 16 px gutters |
| 600–1023 px (iPad portrait, iPad mini, split view) | Navigation rail on the left (icons with labels): Home, Products, Review, Brand page, Store details, Account | One column, forms at most 680 px wide, centred |
| 1024 px and wider (iPad landscape, laptops) | The Build 2 labelled sidebar, unchanged except "Store settings" is now "Store details" | Build 2 desktop layout |

- **Store** (phone tab) is a short page: Brand page, Store details, Commission.
- **Account** (phone tab) is a short page: Team, Help & support, Sign out.
- **Review status** stays a page. On phones it is reached from Home ("See all decisions") and from each
  product's status.
- **Bulk import** is a button on Products (with "Easier on a laptop" on phones).
- Full-screen tasks (product editor, sign-up steps, store detail edits) hide the tab bar and show a Back link
  and one sticky footer button above the home indicator.
- The same features exist at every width.

## 4. Home on phones

- One **"What to do next"** card with one yellow button: the first unfinished setup task (store details,
  brand page, first product), otherwise "Add product".
- A setup task list (until finished), each row a plain status word: *Done*, *To do*.
- **"Needs your changes"**: sent-back items with the reason in plain words and **Fix this**.
- Counts as quiet text rows that link to Products filtered by status (Live 18 · In review 4 · Drafts 3), not tiles.
- The setup banner no longer appears on every page; it lives on Home only.

## 5. Sign-up (V-02) and Store details

One topic per page; *Step x of y*; Back link; Continue saves on this device. Before step 1: what you will
need (pickup address, bank account or UPI ID, GST number if you have one) and about 8 minutes.

| Step | Page | Fields (required unless marked) |
|---|---|---|
| 1 | Your brand | Store name · Sells: Women / Men / Both (radios) · City or area you ship from · Instagram or website (optional) |
| 2 | Contact | Your name · Mobile number · Email |
| 3 | Delivery | Who delivers: **Shazlo delivery service** (we pick up from you) / **We deliver ourselves**. Shazlo: pickup address (address line, area, city, PIN code). Own: areas you deliver to (All of India, or chosen cities / PIN codes as removable chips) and delivery time (1–2, 2–3, 3–5, 5–7 days) |
| 4 | Returns | Return window (No returns / 7 / 14 / 30 days) · Conditions (Unworn with tags / Any reason / Only damaged or wrong items) · Refund time (2 / 5 / 7 working days after pickup) |
| 5 | Payment on delivery | Cash on delivery and/or UPI on delivery (at least one) |
| 6 | Payouts | Bank account (account holder name, account number twice, IFSC; the bank name shows from the IFSC) or UPI ID |
| 7 | Business details and commission | Legal business name (optional) · GST number (optional) · Proposed commission % (optional: "leave empty if you have agreed a rate with our team") · I agree to the seller terms · I agree to the price rule: *my price on Shazlo will never be higher than anywhere else* |
| — | Check your answers | Every answer with **Change**; then **Send application** |

Removed from sign-up (not needed by the app): price range and the long "about your label" text. Product
categories are no longer asked; *Sells* (Women / Men / Both) replaces them.

**Store details** (after approval) is a summary page with one card per topic and a **Change** link that
opens the same page as in sign-up, with Save instead of Continue. Payout numbers are masked
(•••• 4821). Missing required details show *To do* and block sending products for review
("Finish your store details first").

**Brand page** keeps logo, cover, tagline, story, Instagram and website. Return and delivery are no longer
edited there; the preview reads them from store details.

## 6. Commission

| State | Seller sees (Store details › Commission and the price card) | Admin sees (vendor detail) |
|---|---|---|
| Not set | "Not agreed yet. Propose a rate, or our team will set it with you." · price card: "You will see what you receive once your commission is agreed." | **Set rate** |
| Proposed | "You proposed 10%. Waiting for Shazlo." | The proposal with **Approve** / **Send back** (note required), or **Set a different rate** |
| Sent back | Shazlo's note, and a field to propose again | "Sent back: waiting for the brand" |
| Agreed | "12% of each sale." · price card: "You receive ₹2,199 after 12% commission (₹300)" | The rate, with **Change rate** |

There is no default rate anywhere. Approving an application asks for the rate (prefilled from the brand's
proposal, if any).

## 7. Product form (V-07)

Order: **Photos → About the product → Sizes and stock → Price**, then submit.

- **Photos**: 4 required named slots, *Front, Back, Detail, Worn*; up to 4 extra. **Try-on photos**: 5
  required slots, "real people wearing it, so shoppers see the true fit". Picking several photos at once fills
  empty slots in order. Each photo shrinks to about 2000 px before upload and has its own progress and
  *Try again*. "Take photo" is a separate button. Reordering uses "Make main photo" / move buttons, not drag.
- **About the product**: Name · Gender (Women / Men / Unisex chips) · Product type (chips; includes jeans,
  trousers, shirts, T-shirts, tops, kurtas, kurtis, dresses, sarees, dupattas, jackets, blazers…) · Main colour
  (named swatches incl. *Multicolour*) · Other colours (optional, up to 2) · Material (text, e.g. "100% linen")
  · Description.
- **Sizes and stock**: tap a size, type the number in stock (with − / +). Jeans and trousers offer waist sizes
  26–40. Sold-out = 0.
- **Size chart (optional)**, closed until tapped: the measurements for the product type's group (PDF §3, cm,
  all optional) for each chosen size, or a photo of the brand's own chart. Saved for the brand per product
  type: "Used for all your shirts".
- **Price**: Selling price (required) · MRP (optional) · selling price cannot be above MRP · "You receive …"
  line per the commission state · the price rule in one line.
- Returns and delivery are not set per product; they come from store details.
- **Submit** lists every missing item with a link to it: name, gender, product type, main colour, material,
  description, 4 product photos, 5 try-on photos, at least one size, selling price, and complete store details.
- **Phones (under 600 px)**: the editor is a full-screen task in four short steps (the same four sections,
  one per screen) with *Step x of 4*, Back and Next in a sticky footer, then a check page with **Send for
  review**. Wider screens keep the Build 2 single-page editor.

## 8. Calm rules that apply everywhere in the seller portal

- One yellow (primary) button per screen. Yellow never as text, border, focus ring or active-tab colour.
- No badges on tabs; the bell's dot only for items that need changes.
- No new toasts for success; show the result in the page. Errors stay until fixed.
- Validate on Continue / Save / Submit. No asterisks; "(optional)" in words.
- Labels above or inside fields, never placeholder-only. Inputs 16 px. Touch targets 44 px.
- `inputmode` and `autocomplete` on every field that has one. No `type="number"`.
- Transitions off under `prefers-reduced-motion`.
- Plain words. No SKU, variant, listing, QC, catalogue in seller-facing text.
- Web app: manifest, theme colour, `viewport-fit=cover`, safe-area padding on bars and sticky footers, `100dvh`,
  `overscroll-behavior-y: contain` on forms, Back on every inner page.

## Sources

- GOV.UK: form structure https://www.gov.uk/service-manual/design/form-structure · question pages https://design-system.service.gov.uk/patterns/question-pages/ · validation https://design-system.service.gov.uk/patterns/validation/ · check answers https://design-system.service.gov.uk/patterns/check-answers/ · select https://design-system.service.gov.uk/components/select/ · text input https://design-system.service.gov.uk/components/text-input/ · task lists https://design-system.service.gov.uk/patterns/complete-multiple-tasks/
- NN/g: wizards https://www.nngroup.com/articles/wizards/ · lower-literacy users https://www.nngroup.com/articles/writing-for-lower-literacy-users/ · colour https://www.nngroup.com/articles/color-enhance-design/ · icons https://www.nngroup.com/articles/icon-usability/ · progressive disclosure https://www.nngroup.com/articles/progressive-disclosure/
- Apple HIG tab bars https://developer.apple.com/design/human-interface-guidelines/tab-bars · layout https://developer.apple.com/design/human-interface-guidelines/layout
- Android window size classes https://developer.android.com/develop/ui/compose/layouts/adaptive/use-window-size-classes
- WCAG 2.2: target size https://www.w3.org/WAI/WCAG22/Understanding/target-size-minimum.html · non-text contrast https://www.w3.org/WAI/WCAG22/Understanding/non-text-contrast.html · dragging https://www.w3.org/WAI/WCAG22/Understanding/dragging-movements.html · redundant entry https://www.w3.org/WAI/WCAG22/Understanding/redundant-entry.html
- web.dev: PWA app design https://web.dev/learn/pwa/app-design · media capture https://web.dev/articles/media-capturing-images · forms https://web.dev/articles/payment-and-address-form-best-practices · viewport units https://web.dev/blog/viewport-units
- Primer toasts https://primer.style/accessibility/toasts/ · Baymard human model photos https://baymard.com/blog/human-model
- Seller onboarding: Amazon https://sell.amazon.in/seller-blog/amazon-seller-registration · Meesho (Fynd) https://documentation.fynd.com/konnect/channels/marketplaces-webstores/meesho/register-on-meesho · Flipkart pricing change https://www.outlookbusiness.com/news/flipkart-sellers-cant-set-the-selling-price-of-their-products-anymore-allege-fdi-policy-violation · Shopify variants https://help.shopify.com/en/manual/products/variants/add-variants
