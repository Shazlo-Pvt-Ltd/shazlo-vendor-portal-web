// Footer of every wizard step: the same 24 px gutter as the content, buttons spaced by gap.
export const actionsSx = {
  px: { xs: 2, sm: 3 },
  py: 2,
  gap: 1.5,
  flexWrap: 'wrap',
  '& > :not(style) ~ :not(style)': { ml: 0 },
} as const
