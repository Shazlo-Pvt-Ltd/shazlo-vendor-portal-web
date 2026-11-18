import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { PasswordField } from './PasswordField'
import { SafeImage } from './SafeImage'
import { SafeLink } from './SafeLink'
import { clearSensitiveState, registerSensitiveReset } from './sensitiveState'
import { safeHttpsUrl } from './safeUrl'

describe('safeHttpsUrl', () => {
  it.each([
    ['https://brand.example/about', 'https://brand.example/about'],
    ['  https://brand.example  ', 'https://brand.example/'],
    ['https://res.cloudinary.com/x/image/upload/a.jpg?w=200', 'https://res.cloudinary.com/x/image/upload/a.jpg?w=200'],
  ])('accepts %s', (value, expected) => expect(safeHttpsUrl(value)).toBe(expected))

  it.each([
    [null],
    [undefined],
    [''],
    ['javascript:alert(1)'],
    ['JaVaScRiPt:alert(1)'],
    ['data:text/html,<script>alert(1)</script>'],
    ['http://brand.example'],
    ['//brand.example'],
    ['/relative/path'],
    ['https://user:pw@brand.example'],
    ['ftp://brand.example'],
    ['https://'],
    ['https://' + 'a'.repeat(3000) + '.example'],
  ])('refuses %s', (value) => expect(safeHttpsUrl(value as string | null)).toBeUndefined())
})

describe('SafeLink', () => {
  it('links to an https address in a new tab, without opener or referrer', () => {
    render(<SafeLink href="https://brand.example">Our site</SafeLink>)
    const link = screen.getByRole('link', { name: 'Our site' })
    expect(link.getAttribute('href')).toBe('https://brand.example/')
    expect(link.getAttribute('target')).toBe('_blank')
    expect(link.getAttribute('rel')).toBe('noopener noreferrer')
  })

  it('shows an unsafe address as plain text, not as a link', () => {
    render(<SafeLink href="javascript:alert(1)">Our site</SafeLink>)
    expect(screen.queryByRole('link')).toBeNull()
    expect(screen.getByText('Our site')).toBeTruthy()
  })

  it('cannot be given another href, target or rel by the caller', () => {
    // @ts-expect-error target and rel are fixed by the component
    render(<SafeLink href="https://brand.example" target="_self" rel="opener">Site</SafeLink>)
    const link = screen.getByRole('link', { name: 'Site' })
    expect(link.getAttribute('target')).toBe('_blank')
    expect(link.getAttribute('rel')).toBe('noopener noreferrer')
  })
})

describe('SafeImage', () => {
  it('loads an https image with no referrer', () => {
    render(<SafeImage src="https://res.cloudinary.com/x/a.jpg" alt="Logo" />)
    const image = screen.getByRole('img', { name: 'Logo' })
    expect(image.getAttribute('src')).toBe('https://res.cloudinary.com/x/a.jpg')
    expect(image.getAttribute('referrerpolicy')).toBe('no-referrer')
    expect(image.getAttribute('loading')).toBe('lazy')
  })

  it.each(['javascript:alert(1)', 'data:image/svg+xml,<svg onload=alert(1)>', 'http://x.example/a.jpg', ''])(
    'renders the fallback, not an <img>, for %s',
    (src) => {
      render(<SafeImage src={src} alt="Logo" fallback={<span>No logo</span>} />)
      expect(screen.queryByRole('img')).toBeNull()
      expect(screen.getByText('No logo')).toBeTruthy()
    },
  )
})

describe('PasswordField', () => {
  it('asks the password manager for the right thing', () => {
    render(
      <>
        <PasswordField purpose="current" label="Current password" />
        <PasswordField purpose="new" label="New password" />
      </>,
    )
    const current = screen.getByLabelText('Current password')
    const next = screen.getByLabelText('New password')
    expect(current.getAttribute('type')).toBe('password')
    expect(current.getAttribute('autocomplete')).toBe('current-password')
    expect(next.getAttribute('autocomplete')).toBe('new-password')
    expect(next.getAttribute('autocapitalize')).toBe('none')
    expect(next.getAttribute('spellcheck')).toBe('false')
  })

  it('is a password input the user can type into', async () => {
    render(<PasswordField purpose="current" label="Password" />)
    await userEvent.type(screen.getByLabelText('Password'), 'hunter2')
    expect((screen.getByLabelText('Password') as HTMLInputElement).value).toBe('hunter2')
  })
})

describe('sensitive state', () => {
  it('clears every registered form on sign-out, even if one reset fails', () => {
    const first = vi.fn(() => {
      throw new Error('broken reset')
    })
    const second = vi.fn()
    const undo = [registerSensitiveReset(first), registerSensitiveReset(second)]
    clearSensitiveState()
    expect(first).toHaveBeenCalledOnce()
    expect(second).toHaveBeenCalledOnce()
    undo.forEach((fn) => fn())
    clearSensitiveState()
    expect(second).toHaveBeenCalledOnce()
  })
})
