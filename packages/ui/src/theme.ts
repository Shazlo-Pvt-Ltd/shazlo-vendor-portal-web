import { createTheme, type CSSProperties, type Theme, type ThemeOptions } from '@mui/material/styles'
import { voyageFontFaces, type VoyageFontOptions } from './fonts'
import { brand, fontFamily, neutral, radius, status, statusBackground, typeScale, type TypeStyle } from './tokens'

declare module '@mui/material/styles' {
  interface TypographyVariants {
    pageTitle: CSSProperties
    display1: CSSProperties
    display2: CSSProperties
    stat: CSSProperties
    mono: CSSProperties
    informal: CSSProperties
  }
  interface TypographyVariantsOptions {
    pageTitle?: CSSProperties
    display1?: CSSProperties
    display2?: CSSProperties
    stat?: CSSProperties
    mono?: CSSProperties
    informal?: CSSProperties
  }
}

declare module '@mui/material/Typography' {
  interface TypographyPropsVariantOverrides {
    pageTitle: true
    display1: true
    display2: true
    stat: true
    mono: true
    informal: true
  }
}

export interface ShazloThemeOptions {
  // Legacy opt-in loader, retained for compatibility. Penpot defaults use fonts.css instead.
  // @deprecated Use the Penpot font families; only host Voyage with an appropriate licence.
  voyage?: VoyageFontOptions
  // Deep-merged over the Shazlo defaults.
  overrides?: ThemeOptions
}

function type(s: TypeStyle): CSSProperties {
  return {
    fontFamily: fontFamily[s.family],
    fontSize: `${s.size / 16}rem`,
    lineHeight: Math.round((s.lineHeight / s.size) * 1000) / 1000,
    fontWeight: s.weight,
    letterSpacing: `${s.letterSpacing}px`,
  }
}

// Browser surfaces themed from the palette: selection, caret, focus ring, figures.
const baseCss = `
::selection { background: ${brand.cream}; color: ${neutral.ink}; }
:root { caret-color: ${brand.brown}; accent-color: ${brand.brown}; }
:focus-visible { outline: 2px solid ${brand.navy}; outline-offset: 2px; }
b, strong { font-weight: 400; color: ${neutral.ink}; }
a { text-underline-offset: 0.18em; }
`

function baseOptions({ voyage }: ShazloThemeOptions): ThemeOptions {
  return {
    palette: {
      mode: 'light',
      primary: { main: brand.amber, dark: '#D99B19', contrastText: brand.wine },
      secondary: { main: brand.navy, dark: '#0B2A46', contrastText: brand.offWhite },
      success: { main: status.success },
      warning: { main: status.warning },
      error: { main: status.error },
      info: { main: status.info },
      text: { primary: neutral.ink, secondary: neutral.inkSecondary, disabled: neutral.inkTertiary },
      divider: neutral.line,
      background: { default: neutral.canvas, paper: neutral.surface },
      grey: {
        50: neutral.canvas,
        100: neutral.muted,
        200: neutral.line,
        300: neutral.lineStrong,
        500: neutral.inkTertiary,
        700: neutral.inkSecondary,
        900: neutral.ink,
      },
    },
    shape: { borderRadius: radius.control },
    typography: {
      fontFamily: fontFamily.body,
      // Ovo ships one weight; anything heavier would be synthesised by the browser.
      fontWeightMedium: 400,
      fontWeightBold: 400,
      pageTitle: {
        ...type(typeScale.pageTitle),
        '@media (max-width: 599.95px)': { fontSize: '2rem', lineHeight: 1.15, letterSpacing: '-0.3px' },
      },
      display1: type(typeScale.displayXl),
      display2: type(typeScale.displayL),
      h1: type(typeScale.h1),
      h2: type(typeScale.h2),
      h3: type(typeScale.h3),
      h4: type(typeScale.h3),
      h5: { ...type(typeScale.h3), fontSize: '0.8125rem' },
      h6: { ...type(typeScale.h3), fontSize: '0.75rem' },
      subtitle1: type(typeScale.bodyStrong),
      subtitle2: type(typeScale.smallStrong),
      body1: type(typeScale.body),
      body2: type(typeScale.small),
      caption: type(typeScale.caption),
      overline: { ...type(typeScale.overline), textTransform: 'uppercase' },
      button: { ...type(typeScale.bodyStrong), textTransform: 'none' },
      stat: type(typeScale.stat),
      mono: type(typeScale.mono),
      informal: type(typeScale.informal),
    },
    components: {
      MuiCssBaseline: { styleOverrides: (voyage ? voyageFontFaces(voyage) : '') + baseCss },
      MuiTypography: {
        defaultProps: {
          variantMapping: { pageTitle: 'h1', display1: 'h1', display2: 'h2', stat: 'p', mono: 'code', informal: 'p' },
        },
      },
      MuiButton: {
        defaultProps: { disableElevation: true },
        styleOverrides: {
          root: ({ ownerState }) => ({
            borderRadius: radius.control,
            // Amber is a fill, not readable text on cream/off-white.
            ...(ownerState.color === 'primary' && ownerState.variant !== 'contained' && {
              color: brand.wine,
              borderColor: brand.brown,
            }),
          }),
        },
      },
      MuiCheckbox: { styleOverrides: { root: { color: brand.brown, '&.Mui-checked:not(.Mui-disabled)': { color: brand.brown } } } },
      MuiPaper: { defaultProps: { elevation: 0 } },
      MuiCard: {
        defaultProps: { variant: 'outlined' },
        styleOverrides: { root: { borderRadius: radius.card } },
      },
      MuiLink: {
        defaultProps: { color: 'info.main' },
      },
      MuiChip: {
        styleOverrides: {
          root: ({ ownerState }) => {
            const color = ownerState.color
            const semantic = color && color in status ? color as keyof typeof status : undefined
            return {
              borderRadius: radius.pill,
              fontWeight: 400,
              ...(semantic && {
                color: status[semantic],
                backgroundColor: statusBackground[semantic],
                borderColor: status[semantic],
                '& .MuiChip-icon, & .MuiChip-deleteIcon': { color: 'inherit' },
                '&:hover, &.Mui-focusVisible': { backgroundColor: statusBackground[semantic] },
              }),
            }
          },
        },
      },
      MuiOutlinedInput: {
        styleOverrides: {
          root: {
            borderRadius: radius.control,
            '&.Mui-focused:not(.Mui-error):not(.Mui-disabled) .MuiOutlinedInput-notchedOutline': { borderColor: brand.brown },
          },
          notchedOutline: ({ ownerState, theme: muiTheme }) => ({
            borderColor: ownerState.error ? status.error : ownerState.disabled ? muiTheme.palette.action.disabled : brand.brown,
          }),
        },
      },
      // 16 px inputs on phones, so iOS does not zoom the page when a field gets focus.
      MuiInputBase: { styleOverrides: { input: { '@media (max-width: 899.95px)': { fontSize: '1rem' } } } },
      MuiInputLabel: { styleOverrides: { root: { '&.Mui-focused:not(.Mui-error):not(.Mui-disabled)': { color: brand.brown } } } },
    },
  }
}

export function createShazloTheme(options: ShazloThemeOptions = {}): Theme {
  return createTheme(baseOptions(options), options.overrides ?? {})
}

export const theme = createShazloTheme()
