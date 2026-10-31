# @shazlo/ui

Shared MUI theme and design tokens for the new Shazlo apps. The palette and font roles follow the Penpot **Design language** board inspected on 29 October 2026: amber/cream, navy, wine, Bodoni Moda headings, Ovo body and Schoolbell informal text. See the [captured source and scope](docs/penpot-design.md). Type sizes, spacing and radii are implementation choices; this package does not implement entire wireframe screens or automatically follow future Penpot edits.

## Use

```tsx
import { CssBaseline, ThemeProvider } from '@mui/material'
import { theme } from '@shazlo/ui'
import '@shazlo/ui/fonts.css'

<ThemeProvider theme={theme}>
  <CssBaseline />
  <App />
</ThemeProvider>
```

Add `"@shazlo/ui": "*"` to the app's dependencies; npm workspaces link it. The package exports TypeScript source and font CSS, so Vite and TypeScript consume it directly. Apps need MUI 9, Emotion and React 19 peer dependencies. Import the font CSS once at the app entry point; it bundles local Fontsource assets with no third-party font requests. Include the fonts' license texts when distributing an application (the demo includes them).

| Export | Purpose |
|---|---|
| `theme` | Default light MUI theme |
| `createShazloTheme({ overrides?, voyage? })` | Deep-merged overrides; legacy opt-in Voyage loader |
| `tokens` | All raw token groups, also exported individually |
| `brand`, `neutral`, `annotation`, `link` | Source palette, supporting neutrals, annotation-only raspberry and darker link text |
| `status`, `statusBackground`, `reviewStatus` | Paired status foregrounds/backgrounds and product review states |
| `fontFamily`, `typeScale`, `space`, `radius`, `shadow` | Typography and retained geometry choices |
| `contrastRatio(a, b)` | WCAG contrast for `#RRGGBB` pairs |
| `voyageFontFaces({ baseUrl })`, `voyageFontFiles` | Legacy compatibility utilities; appropriate commercial licensing required |

Extra `Typography` variants: `display1` (64), `display2` (40), `stat` (28), `informal` (16) and `mono` (12). Bodoni Moda is used for headings/display/stat; Ovo for formal body; Schoolbell for informal body; monospace uses the system stack. Ovo/Schoolbell use regular weight. `theme.spacing()` retains MUI's 8 px unit; `space` exposes the 4 px grid. Dark mode is outside this scope.

## Color and status rules

- Primary actions: amber `#FAB62A` with wine `#620032` text. Secondary actions: navy `#103C64` with off-white `#FFFCE3`. Text/outlined primary actions use wine, not amber text.
- Use `link.text` (`#2E6A93`) for links. Raw blue `#4281AA` is for fills/icons and fails normal-text AA on off-white.
- Pair every status with a label/icon. `reviewStatus` gives live blue, pending cream/brown, sent-back orange/brown and suspended wine. Raspberry is only for design annotations.
- Use `reviewStatus[state].foreground` as text and `.background` as fill. Normal semantic MUI chips map `success`/`info` to blue, `warning` to pending cream, `error` to wine. Sent-back has its separate orange pair.
- Tests check the actual paired text/fill contrast, rendered action/link/control styles and the independently captured design contract.

This private package replaces the old `brand.black/gold/white` keys. Its first-party consumer tests and demo are updated together. The separate legacy website is not migrated by this theme PR.

## Fonts

Bodoni Moda and Ovo are OFL-1.1; Schoolbell is Apache-2.0. Their local Fontsource dependencies and license files are included with the demo. See [Fontsource installation documentation](https://fontsource.org/docs/getting-started/install) and the [source baseline](docs/penpot-design.md).

Voyage is no longer a default family or demo asset. Its commercial web license is unconfirmed. The compatibility loader can still declare licensed self-hosted files with `createShazloTheme({ voyage: { baseUrl: '/fonts' } })`, but selecting that family requires an explicit typography override. Unsafe CSS URL characters remain rejected. No commercial font files are shipped in this package.

## Demo and checks

```sh
npm run demo --workspace @shazlo/ui
npm run build:demo --workspace @shazlo/ui
npm test -- --project ui --project vendor-portal
npm run typecheck
```

The production demo build runs in apps CI on every PR and pushes to main, alongside the existing repository tests and legacy app build. The demo serves only its own assets and font licenses. It shows the palette, typography, controls, labeled review states and a navy shell specimen.

The previous black/gold screenshot has been removed because it no longer represents this theme.

Unit tests cover the external design snapshot, contrast arithmetic, theme overrides and legacy font-URL safety. Real MUI/jsdom tests cover emitted styles, semantic typography and demo content. Vendor-portal tests verify workspace consumption. The production build checks emitted font families/weights, local asset paths and included license texts. Browser verification of actual font loading/layout remains separate; these tests do not prove complete screen parity or application journeys.
