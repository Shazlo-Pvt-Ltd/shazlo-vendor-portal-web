import { screen, within } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { renderShell } from '../test/render'

const PITCH = 'One place to run Shazlo'
const POINTS = [
  ['Vendors', 'Review applications, brand pages and products before they reach the app.'],
  ['Every decision on record', 'Each decision is recorded under your name, and sellers see your reason word for word.'],
  ['Roles, not shared logins', 'Everyone has their own account and sees only the modules their role allows.'],
] as const

const font = (el: HTMLElement) => {
  const style = getComputedStyle(el)
  return { family: style.fontFamily, weight: style.fontWeight }
}

async function openSignIn() {
  const view = await renderShell({ route: '/sign-in', as: null })
  await screen.findByRole('heading', { level: 1, name: 'Sign in to Shazlo One' })
  return view
}

describe('A-01 sign in: the navy panel', () => {
  it('heads the panel with the pitch, set in semibold, with no full stop', async () => {
    await openSignIn()
    const panel = screen.getByRole('complementary', { name: PITCH })
    const heading = within(panel).getByRole('heading', { level: 2, name: PITCH })
    expect(font(heading).family).toContain('Bodoni Moda')
    expect(font(heading).weight).toBe('600')
  })

  it('makes three points, each an icon, a semibold title and a regular description', async () => {
    await openSignIn()
    const panel = screen.getByRole('complementary', { name: PITCH })
    const items = within(panel).getAllByRole('listitem')
    expect(items).toHaveLength(POINTS.length)
    POINTS.forEach(([title, body], i) => {
      const item = items[i]!
      const titleText = within(item).getByText(title)
      expect(font(titleText)).toEqual({ family: expect.stringContaining('Bodoni Moda'), weight: '600' })
      expect(font(within(item).getByText(body))).toEqual({ family: expect.stringContaining('Ovo'), weight: '400' })
      const icon = item.querySelector('svg')
      expect(icon).toHaveAttribute('aria-hidden', 'true')
      expect(icon).toHaveAttribute('stroke-width', '1.75')
    })
  })

  it('draws the new logo in amber, with no colour filter', async () => {
    await openSignIn()
    const panel = screen.getByRole('complementary', { name: PITCH })
    const logo = within(panel).getByRole('img', { name: 'Shazlo' })
    expect(logo).toHaveAttribute('data-tone', 'amber')
    expect(getComputedStyle(logo).filter).toMatch(/^(none)?$/)
    expect(getComputedStyle(logo.parentElement!).filter).toMatch(/^(none)?$/)
  })

  it('no longer says the tool is internal or logged', async () => {
    await openSignIn()
    expect(screen.queryByText(/internal tool/i)).toBeNull()
    expect(screen.queryByText(/access is logged/i)).toBeNull()
  })
})

describe('A-01 sign in: the form', () => {
  it('sets the heading in semibold and keeps the navy logo for phones', async () => {
    await openSignIn()
    const heading = screen.getByRole('heading', { level: 1, name: 'Sign in to Shazlo One' })
    expect(font(heading)).toEqual({ family: expect.stringContaining('Bodoni Moda'), weight: '600' })
    const phoneLogo = within(screen.getByRole('main')).getByRole('img', { name: 'Shazlo', hidden: true })
    expect(phoneLogo).toHaveAttribute('data-tone', 'navy')
  })

  it('says who resets a forgotten password, the question in semibold', async () => {
    await openSignIn()
    const question = screen.getByText('Forgot your password?')
    expect(font(question)).toEqual({ family: expect.stringContaining('Bodoni Moda'), weight: '600' })
    expect(question.parentElement).toHaveTextContent('Forgot your password? A super admin can reset it.')
    expect(screen.queryByText(/Admins & roles/)).toBeNull()
  })
})
