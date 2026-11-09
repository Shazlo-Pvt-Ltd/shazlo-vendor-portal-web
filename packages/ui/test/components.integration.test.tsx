// @vitest-environment jsdom
import { ThemeProvider } from '@mui/material'
import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import { theme } from '../src'
import { Button, NavItem, StatCard, StatusBadge, TextInput } from '../src/components'

const wrap = (ui: React.ReactNode) => render(<ThemeProvider theme={theme}>{ui}</ThemeProvider>)

afterEach(() => cleanup())

describe('kit components', () => {
  it('renders router links as real anchors with an href', () => {
    wrap(
      <>
        <NavItem to="/products" icon="package" label="Products" count={27} active />
        <Button variant="primary" to="/products/new" icon="plus">Add product</Button>
        <StatCard to="/products?tab=live" label="Live on Shazlo" value={18} />
      </>,
    )
    const nav = screen.getByRole('link', { name: /Products/ })
    expect(nav.getAttribute('href')).toBe('/products')
    expect(nav.getAttribute('aria-current')).toBe('page')
    expect(nav.hasAttribute('to')).toBe(false)
    expect(screen.getByRole('link', { name: 'Add product' }).getAttribute('href')).toBe('/products/new')
    expect(screen.getByRole('link', { name: /Live on Shazlo/ }).getAttribute('href')).toBe('/products?tab=live')
  })

  it('pairs every status with a word, not colour alone', () => {
    wrap(<StatusBadge tone="sentBack" />)
    expect(screen.getByText('Sent back')).toBeTruthy()
  })

  it('links field errors to the input', () => {
    wrap(<TextInput label="Work email" error="Enter your work email" />)
    const input = screen.getByLabelText('Work email')
    expect(input.getAttribute('aria-invalid')).toBe('true')
    const describedBy = input.getAttribute('aria-describedby')
    expect(describedBy && document.getElementById(describedBy)?.textContent).toBe('Enter your work email')
  })
})
