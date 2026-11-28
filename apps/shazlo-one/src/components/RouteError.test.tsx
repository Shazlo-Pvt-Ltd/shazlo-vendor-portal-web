import { render, screen } from '@testing-library/react'
import { RouterProvider, createMemoryRouter } from 'react-router'
import { describe, expect, it, vi } from 'vitest'
import { RouteError } from './RouteError'

function Bomb(): never {
  throw new Error('secret internal detail: db password is hunter2')
}

describe('RouteError', () => {
  it('shows a plain message with one h1, a title and no stack trace when a route throws', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined)
    const router = createMemoryRouter([{ path: '/', element: <Bomb />, errorElement: <RouteError /> }])
    render(<RouterProvider router={router} />)
    expect(await screen.findByRole('heading', { level: 1, name: 'Something went wrong' })).toBeTruthy()
    expect(screen.getAllByRole('heading', { level: 1 })).toHaveLength(1)
    expect(document.body.textContent).not.toMatch(/hunter2|secret internal|at Bomb|\.tsx/)
    expect(document.title).toBe('Something went wrong · Shazlo-One')
  })
})
