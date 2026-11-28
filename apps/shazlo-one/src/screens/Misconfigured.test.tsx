import { render, screen, within } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { Misconfigured } from './Misconfigured'

describe('the "not set up correctly" page', () => {
  it('says the shell will not start, and lists each problem as text', () => {
    render(<Misconfigured problems={['VITE_IDENTITY_API_URL is not set.', 'VITE_MOCK_API must be "on", "off" or not set.', '<img src=x onerror=alert(1)>']} />)
    const alert = screen.getByRole('alert')
    expect(within(alert).getByRole('heading', { level: 1, name: 'Shazlo One is not set up correctly' })).toBeInTheDocument()
    expect(within(alert).getAllByRole('listitem').map((li) => li.textContent)).toEqual(['VITE_IDENTITY_API_URL is not set.', 'VITE_MOCK_API must be "on", "off" or not set.', '<img src=x onerror=alert(1)>'])
    expect(document.querySelector('img[src="x"]')).toBeNull()
  })
})
