// @vitest-environment jsdom
// Renders real MUI components with the theme in a DOM and checks the CSS that reaches the page.
import { Button, Checkbox, Chip, CssBaseline, Link, TextField, ThemeProvider, Typography } from '@mui/material'
import type { Theme } from '@mui/material/styles'
import { cleanup, render, screen } from '@testing-library/react'
import type { ReactNode } from 'react'
import { afterEach, describe, expect, it } from 'vitest'
import { createShazloTheme, neutral, theme } from '../src'

afterEach(cleanup)

const renderWith = (ui: ReactNode, t: Theme = theme) =>
  render(
    <ThemeProvider theme={t}>
      <CssBaseline />
      {ui}
    </ThemeProvider>,
  )

const rgb = (hex: string) => {
  const n = parseInt(hex.slice(1), 16)
  return `rgb(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255})`
}

// MUI 9 sets colours through CSS variables; jsdom keeps var() unresolved, so resolve one level here.
const colour = (el: Element, prop: 'backgroundColor' | 'color') => {
  const style = getComputedStyle(el)
  const value = style[prop]
  const v = /^var\((--[\w-]+)\)$/.exec(value)
  const resolved = v?.[1] ? style.getPropertyValue(v[1]).trim() : value
  return /^#[0-9a-f]{6}$/i.test(resolved) ? rgb(resolved) : resolved
}

const pageCss = () => Array.from(document.querySelectorAll('style'), (s) => s.textContent ?? '').join('\n')

describe('theme rendered with MUI', () => {
  it('primary buttons are amber with wine text', () => {
    renderWith(<Button variant="contained">Submit for review</Button>)
    const button = screen.getByRole('button', { name: 'Submit for review' })
    expect(colour(button, 'backgroundColor')).toBe(rgb('#FAB62A'))
    expect(colour(button, 'color')).toBe(rgb('#620032'))
    expect(getComputedStyle(button).textTransform).toBe('none')
  })

  it('secondary buttons are navy with off-white text', () => {
    renderWith(
      <Button variant="contained" color="secondary">
        Add product
      </Button>,
    )
    const button = screen.getByRole('button', { name: 'Add product' })
    expect(colour(button, 'backgroundColor')).toBe(rgb('#103C64'))
    expect(colour(button, 'color')).toBe(rgb('#FFFCE3'))
  })

  it('display variants render as headings in Bodoni Moda', () => {
    renderWith(
      <>
        <Typography variant="display1">Kalki Studio</Typography>
        <Typography variant="display2">Brand page</Typography>
      </>,
    )
    const h1 = screen.getByRole('heading', { level: 1, name: 'Kalki Studio' })
    const h2 = screen.getByRole('heading', { level: 2, name: 'Brand page' })
    expect(getComputedStyle(h1).fontFamily).toMatch(/^"?Bodoni Moda/)
    expect(getComputedStyle(h2).fontFamily).toMatch(/^"?Bodoni Moda/)
  })

  it('mono renders as <code>, stat and informal as <p>', () => {
    renderWith(
      <>
        <Typography variant="mono">KS-AJR-014</Typography>
        <Typography variant="stat">18</Typography>
        <Typography variant="informal">A little joy</Typography>
      </>,
    )
    expect(screen.getByText('KS-AJR-014').tagName).toBe('CODE')
    expect(screen.getByText('18').tagName).toBe('P')
    expect(screen.getByText('A little joy').tagName).toBe('P')
    expect(getComputedStyle(screen.getByText('A little joy')).fontFamily).toMatch(/^"?Schoolbell/)
  })

  it('CssBaseline paints the warm canvas and Ovo body text', () => {
    renderWith(<span>page</span>)
    const body = getComputedStyle(document.body)
    expect(body.backgroundColor).toBe(rgb(neutral.canvas))
    expect(body.fontFamily).toMatch(/^"?Ovo/)
  })

  it('text/outlined actions and links do not use amber or the lighter brand blue as text', () => {
    renderWith(<>
      <Button>Discard draft</Button>
      <Button variant="outlined">Bulk import</Button>
      <Link href="/products">View products</Link>
    </>)
    for (const name of ['Discard draft', 'Bulk import']) {
      expect(colour(screen.getByRole('button', { name }), 'color')).toBe(rgb('#620032'))
    }
    expect(colour(screen.getByRole('link', { name: 'View products' }), 'color')).toBe(rgb('#2E6A93'))
  })

  it('renders labelled status chips with the semantic text and fill together', () => {
    renderWith(<>
      <Chip color="success" label="Live" />
      <Chip color="warning" label="Pending" />
      <Chip color="error" label="Suspended" />
    </>)
    for (const [label, foreground, background] of [
      ['Live', '#2E6A93', '#E5EFF5'],
      ['Pending', '#7A451E', '#FFEDA3'],
      ['Suspended', '#620032', '#F6E5EC'],
    ]) {
      const chip = screen.getByText(label!).parentElement!
      expect(colour(chip, 'color')).toBe(rgb(foreground!))
      expect(colour(chip, 'backgroundColor')).toBe(rgb(background!))
    }
  })

  it('uses brown for checked controls and focused input labels/outlines', () => {
    renderWith(<>
      <Checkbox checked slotProps={{ input: { 'aria-label': 'Select product' } }} />
      <TextField label="Brand name" focused />
    </>)
    expect(colour(screen.getByRole('checkbox', { name: 'Select product' }).parentElement!, 'color')).toBe(rgb('#7A451E'))
    expect(colour(document.querySelector('label.Mui-focused')!, 'color')).toBe(rgb('#7A451E'))
    expect(getComputedStyle(document.querySelector('fieldset')!).borderColor).toBe(rgb('#7A451E'))
  })

  it('preserves error styling when an invalid field is focused', () => {
    renderWith(<TextField label="Email" error focused />)
    expect(colour(document.querySelector('label.Mui-error')!, 'color')).toBe(rgb('#620032'))
    expect(getComputedStyle(document.querySelector('fieldset')!).borderColor).toBe(rgb('#620032'))
  })
})

describe('Voyage loading in the page', () => {
  it('adds no @font-face rules by default', () => {
    renderWith(<span>page</span>)
    expect(pageCss()).not.toContain('@font-face')
  })

  it('adds both weights when the app hosts the files', () => {
    renderWith(<span>page</span>, createShazloTheme({ voyage: { baseUrl: '/fonts' } }))
    const css = pageCss()
    expect(css.match(/@font-face/g)).toHaveLength(2)
    expect(css).toContain("url('/fonts/voyage-regular.otf')")
    expect(css).toContain("url('/fonts/voyage-bold.otf')")
  })
})
