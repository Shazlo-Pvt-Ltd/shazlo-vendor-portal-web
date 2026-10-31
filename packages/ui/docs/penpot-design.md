# Inspected Penpot design baseline

Source: [Shazlo in Penpot](https://design.penpot.app/?screen=workspace&team-id=685eebd9-2ce2-80a4-8008-d702ad7258d4&file-id=685eebd9-2ce2-80a4-8008-d702c75c4edc&page-id=685eebd9-2ce2-80a4-8008-d702c75c4edd),
page **00 · Cover & Kit**, board **Design language**
(`bece356c-c96f-8036-8008-d7f8e96182ee`). Inspected directly on **29 October 2026**.
The cover says “v0.1 · 25 Oct 2026 · for team review”. Neither a revision ID nor
the actual last-modified timestamp was available; the cover date is not an edit timestamp.

[`penpot-design.json`](penpot-design.json) transcribes the board's palette and
roles independently of the implementation. The contract tests compare the public
theme against that baseline. This is an inspected snapshot, not automatic live
Penpot synchronization: a later design edit requires another inspection, baseline
update and review. No claim of matching future edits or complete screen layouts
is made.

## Source values and roles

| Source value | Role stated by the design |
|---|---|
| Cream `#FFEDA3` | Active navigation, pending badges, highlights |
| Amber `#FAB62A` | Logo, primary buttons, active states, alerts |
| Brown `#7A451E` | Checkboxes, pending text, warm accents |
| Blue `#4281AA` | Informational icons and fills |
| Link blue `#2E6A93` | Accessible link text; the lighter blue fails AA for normal text |
| Navy `#103C64` | Shazlo-One shell, sign-in and bulk actions |
| Off-white `#FFFCE3` | Text on dark and surfaces |
| Wine `#620032` | Text on amber |
| Ink `#17120E` | Body text |
| Canvas `#FFF8E1` | Page background |
| Raspberry `#C2255C` | Design annotations only |

Headings use **Bodoni Moda**, the board's substitute for Bodoni FLF. Formal body
text uses **Ovo**, its alternative to Footlight. Informal body text uses
**Schoolbell**, its substitute for Handyman. The package uses the fonts actually
named on the Penpot board. Bodoni Moda and Ovo use OFL-1.1; Schoolbell uses
Apache-2.0. Font files are served locally through Fontsource, with license texts
included in the demo distribution. The default demo has no commercial Voyage
assets or requests to Google Fonts. The legacy Voyage loader remains an opt-in
compatibility utility; it does not change the default family.

Primary buttons use amber with wine text. Outlined/text primary buttons use wine
text, because amber text on a cream surface is unreadable. Navy actions use
off-white text. Links use the explicit darker blue. Checkboxes and focused input
labels/outlines use brown. The demo includes a navy shell specimen with an amber
action; it is not an implemented admin application.

Review states retain their icon and label in addition to color: **Live** is blue,
**Pending** cream/brown, **Sent back** an orange tint/brown, **Suspended** a wine
tint/wine. `reviewStatus` exposes the paired foreground/background values.
Raspberry is exported separately as `annotation`, never as a product status.

## Implementation choices

The board gives color/font roles, not numeric type sizes, spacing, radii or a
complete component specification. Existing sizes and geometry are retained as
implementation choices; they are not presented as measurements from Penpot.
Body weights use the available regular weight instead of synthesizing bold Ovo.
System monospace is used for technical samples only.

Supporting neutral values (`#806F57`, `#D9CAA8`, `#A99572`, `#F2E6C5`), blue
`#E5EFF5`, orange `#FCE7D0` and wine `#F6E5EC` tints are implementation choices,
not verbatim board swatches. Status/link/button contrast is tested against the
actual paired backgrounds, including default contained-button hover shades.
Amber `#D99B19` and navy `#0B2A46` hover shades are also implementation choices;
MUI's automatically darkened amber would lower contrast with wine text.
Disabled controls and decorative dividers are not normal body text.

`brand.black`, `brand.gold` and `brand.white` are replaced by the named palette.
All first-party consumers of this private, unmerged package are updated together.
The legacy website's separate theme is not migrated: PR #44 provides the new
shared theme; the new vendor/admin applications are still scaffolds.

## Verification and limits

| Risk | Decision / evidence |
|---|---|
| Reintroducing the obsolete palette or font roles | ADD independent captured-design contract; EXTEND rendered MUI and consumer tests |
| Amber/blue used as unreadable text, wrong status fill | EXTEND contrast and rendered button/link/input/chip assertions |
| Missing fonts or wrong CSS family in the shipped artifact | ADD demo production build and artifact checks to every PR and main; browser font loading/layout remains separate |
| Claiming full frame parity from token tests | DEFER screen acceptance until the vendor/admin applications exist; do not label the token demo a full wireframe implementation |
| Future Penpot changes | Manual reinspection required; tests only enforce this recorded baseline |

Run `npm test -- --project ui --project vendor-portal`, `npm run typecheck`,
`npm run build:demo --workspace @shazlo/ui`, then the full repository checks in
[`docs/testing.md`](../../../docs/testing.md). The old black/gold screenshot was
removed because it no longer represents the theme. jsdom verifies emitted styles
and semantics; the production artifact check verifies font families, weights,
local font files and license texts. Browser inspection separately verifies actual
font loading and layout. Chrome extension DOM inspection confirms the body/heading font styles, canvas
background and no horizontal overflow at the current viewport. Screenshot and
font-resource inspection have intermittently failed; no new screenshot, verified
font loading or complete visual acceptance is claimed. Further browser checks
use only the Chrome extension, with no native desktop control.
