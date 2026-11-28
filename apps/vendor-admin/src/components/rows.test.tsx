import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { onRowClick, RowChevron } from './rows'

function Row({ open }: { open: () => void }) {
  return (
    <table>
      <tbody>
        <tr onClick={onRowClick(open)} data-testid="row">
          <td>
            <a href="#item" onClick={(e) => e.preventDefault()}>
              Item
            </a>
          </td>
          <td>Vendor</td>
          <td>
            <button type="button">Menu</button>
            <RowChevron />
          </td>
        </tr>
      </tbody>
    </table>
  )
}

describe('onRowClick, the fallback for a click beside the row’s link', () => {
  it('opens the item from a click on the row', async () => {
    const open = vi.fn()
    render(<Row open={open} />)
    await userEvent.click(screen.getByText('Vendor'))
    expect(open).toHaveBeenCalledTimes(1)
  })

  it('leaves clicks on the link and on other controls to them', async () => {
    const open = vi.fn()
    render(<Row open={open} />)
    await userEvent.click(screen.getByRole('link', { name: 'Item' }))
    await userEvent.click(screen.getByRole('button', { name: 'Menu' }))
    expect(open).not.toHaveBeenCalled()
  })

  it('opens once for a double click', async () => {
    const open = vi.fn()
    render(<Row open={open} />)
    await userEvent.dblClick(screen.getByText('Vendor'))
    expect(open).toHaveBeenCalledTimes(1)
  })
})

describe('RowChevron', () => {
  it('is decoration only, hidden from screen readers', () => {
    render(<RowChevron />)
    const chevron = document.querySelector('[data-chevron]')!
    expect(chevron).toHaveAttribute('aria-hidden', 'true')
    expect(chevron.querySelector('svg')).not.toBeNull()
  })
})
