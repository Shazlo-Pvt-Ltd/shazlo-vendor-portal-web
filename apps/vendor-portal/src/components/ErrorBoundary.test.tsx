import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useState } from 'react'
import { describe, expect, it, vi } from 'vitest'
import { ErrorBoundary } from './ErrorBoundary'

function Bomb({ explode }: { explode: boolean }) {
  if (explode) {
    throw new Error('secret internal detail: db password is hunter2')
  }
  return <p>All fine</p>
}

function Harness() {
  const [explode, setExplode] = useState(true)
  return (
    <ErrorBoundary>
      <button onClick={() => setExplode(false)}>defuse</button>
      <Bomb explode={explode} />
    </ErrorBoundary>
  )
}

describe('ErrorBoundary', () => {
  it('shows a plain message, never the error or a stack', () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined)
    render(<Harness />)
    expect(screen.getByRole('heading', { level: 1, name: 'Something went wrong' })).toBeTruthy()
    expect(document.body.textContent).not.toMatch(/hunter2|secret internal|at Bomb|\.tsx/)
  })

  it('offers to try again, and recovers when the cause is gone', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined)
    // The first render throws; after "Try again" the same child must not throw.
    let explode = true
    function Flaky() {
      if (explode) {
        throw new Error('boom')
      }
      return <p>Recovered</p>
    }
    render(
      <ErrorBoundary>
        <Flaky />
      </ErrorBoundary>,
    )
    explode = false
    await userEvent.click(screen.getByRole('button', { name: 'Try again' }))
    expect(screen.getByText('Recovered')).toBeTruthy()
  })

  it('renders its children when nothing is wrong', () => {
    render(
      <ErrorBoundary>
        <Bomb explode={false} />
      </ErrorBoundary>,
    )
    expect(screen.getByText('All fine')).toBeTruthy()
  })
})
