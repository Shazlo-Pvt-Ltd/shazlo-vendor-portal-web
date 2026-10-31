import { createTheme, type CSSProperties, type Theme, type ThemeOptions } from '@mui/material/styles'
import { voyageFontFaces, type VoyageFontOptions } from './fonts'
import { brand, fontFamily, neutral, radius, status, statusBackground, typeScale, type TypeStyle } from './tokens'

declare module '@mui/material/styles' {
  interface TypographyVariants {
    display1: CSSProperties
    display2: CSSProperties
    stat: CSSProperties
    mono: CSSProperties
    informal: CSSProperties
  }
  interface TypographyVariantsOptions {
    display1?: CSSProperties
    display2?: CSSProperties
    stat?: CSSProperties
    mono?: CSSProperties
    informal?: CSSProperties
  }
}

declare module '@mui/material/Typography' {
  interface TypographyPropsVariantOverrides {
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
      MuiCssBaseline: voyage ? { styleOverrides: voyageFontFaces(voyage) } : {},
      MuiTypography: {
        defaultProps: {
          variantMapping: { display1: 'h1', display2: 'h2', stat: 'p', mono: 'code', informal: 'p' },
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
      MuiInputLabel: { styleOverrides: { root: { '&.Mui-focused:not(.Mui-error):not(.Mui-disabled)': { color: brand.brown } } } },
    },
  }
}

export function createShazloTheme(options: ShazloThemeOptions = {}): Theme {
  return createTheme(baseOptions(options), options.overrides ?? {})
}

export const theme = createShazloTheme()
