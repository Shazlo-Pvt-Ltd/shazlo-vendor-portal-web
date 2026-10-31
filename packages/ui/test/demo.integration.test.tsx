// @vitest-environment jsdom
// The token demo page must show every token, so a token added to src/tokens.ts without a demo entry fails here.
import { ThemeProvider } from '@mui/material'
import { cleanup, render, screen, within } from '@testing-library/react'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { App } from '../demo/App'
import { brand, neutral, radius, status, theme } from '../src'

const renderDemo = () =>
  render(
    <ThemeProvider theme={theme}>
      <App />
    </ThemeProvider>,
  )

describe('token demo page', () => {
  // Every assertion is read-only; render the large specimen once instead of seven times.
  beforeAll(renderDemo)
  afterAll(cleanup)

  it('has a section for each token group', () => {
    for (const title of ['Brand', 'Neutrals', 'Status', 'Links and annotations', 'Type scale', 'Spacing (4 px grid) and radius', 'Components', 'Shazlo-One shell']) {
      expect(screen.getByRole('region', { name: title })).toBeTruthy()
    }
  })

  it.each([
    ['Brand', brand],
    ['Neutrals', neutral],
    ['Status', status],
  ] as const)('shows every %s colour with its hex value', (title, colors) => {
    const section = within(screen.getByRole('region', { name: title }))
    for (const [name, hex] of Object.entries(colors)) {
      expect(section.getByText(name)).toBeTruthy()
      const card = section.getByText(name).closest('.MuiCard-root')!
      expect(within(card as HTMLElement).getByText(hex)).toBeTruthy()
    }
  })

  it('shows every typography variant and radius', () => {
    const type = within(screen.getByRole('region', { name: 'Type scale' }))
    for (const v of ['display1', 'display2', 'h1', 'h2', 'h3', 'body1', 'body2', 'caption', 'overline', 'stat', 'informal', 'mono']) {
      expect(type.getByText(new RegExp(`^${v} ·`))).toBeTruthy()
    }
    const shape = within(screen.getByRole('region', { name: 'Spacing (4 px grid) and radius' }))
    for (const [name, r] of Object.entries(radius)) expect(shape.getByText(`${name} ${r}`)).toBeTruthy()
  })

  it('shows the themed components', () => {
    const section = within(screen.getByRole('region', { name: 'Components' }))
    for (const label of ['Submit for review', 'Add product', 'Bulk import', 'Discard draft']) {
      expect(section.getByRole('button', { name: label })).toBeTruthy()
    }
    expect(section.getByRole('alert')).toBeTruthy()
    for (const label of ['Live', 'Pending review', 'Sent back', 'Suspended']) {
      const chip = section.getByText(label).closest('.MuiChip-root')!
      expect(chip.querySelector('[aria-hidden="true"]')).toBeTruthy()
    }
  })

  it('links to the inspected source and labels the theme scope without claiming screen parity', () => {
    expect(screen.getByRole('link', { name: 'View the design source' }).getAttribute('href')).toContain('file-id=685eebd9-2ce2-80a4-8008-d702c75c4edc')
    expect(screen.getByText(/inspected on 29 October 2026/)).toBeTruthy()
  })
})
