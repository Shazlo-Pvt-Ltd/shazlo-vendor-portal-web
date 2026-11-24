import { render, screen } from '@testing-library/react'
import { RouterProvider, createMemoryRouter } from 'react-router'
import { describe, expect, it } from 'vitest'
import { routes } from './routes'

function open(path: string) {
  render(<RouterProvider router={createMemoryRouter(routes, { initialEntries: [path] })} />)
}

describe('routes', () => {
  it('serves the empty shell at the root, with one h1', async () => {
    open('/')
    expect(await screen.findByRole('heading', { level: 1, name: 'Shazlo One' })).toBeTruthy()
    expect(screen.getAllByRole('heading', { level: 1 })).toHaveLength(1)
    expect(document.title).toBe('Shazlo One · Shazlo One')
  })

  it('shows a not-found page, with one h1 and a title, for an unknown address', async () => {
    open('/nowhere')
    expect(await screen.findByRole('heading', { level: 1, name: 'Page not found' })).toBeTruthy()
    expect(screen.getAllByRole('heading', { level: 1 })).toHaveLength(1)
    expect(document.title).toBe('Page not found · Shazlo One')
    expect(screen.getByRole('link', { name: 'Go to the start page' }).getAttribute('href')).toBe('/')
  })
})
