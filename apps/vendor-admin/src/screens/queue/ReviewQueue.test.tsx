import { fireEvent, screen, within } from '@testing-library/react'
import { beforeEach, describe, expect, it } from 'vitest'
import { resetMock } from '../../api'
import { renderRoute } from '../../test/render'

const bodyRows = () => [...screen.getByLabelText('Review queue', { selector: 'table' }).querySelectorAll<HTMLElement>('tbody tr')]

describe('A-04 Review queue', () => {
  beforeEach(() => resetMock())

  it('shows queue health, every item type and the rows oldest first', async () => {
    renderRoute('/queue')
    expect(await screen.findByRole('heading', { name: 'Review queue' })).toBeTruthy()
    await screen.findByLabelText('Review queue', { selector: 'table' }, { timeout: 8000 })
    const rows = bodyRows()
    expect(rows).toHaveLength(14)
    expect(within(rows[0]!).getByText('Saanjh Label')).toBeTruthy()
    expect(within(rows[0]!).getByText('1 d 2 h')).toBeTruthy()
    expect(within(rows[3]!).getByText('Resubmission #2')).toBeTruthy()
    expect(screen.getByText('14 items waiting · oldest first')).toBeTruthy()
    expect(screen.getByText('8 approved · 3 sent back')).toBeTruthy()
    expect(screen.getByRole('tab', { name: /Products/ }).textContent).toContain('9')
  })

  it('filters by tab, resubmissions and search', async () => {
    renderRoute('/queue')
    await screen.findByLabelText('Review queue', { selector: 'table' }, { timeout: 8000 })
    fireEvent.click(screen.getByRole('tab', { name: /Brand pages/ }))
    expect(bodyRows()).toHaveLength(2)
    fireEvent.click(screen.getByRole('tab', { name: /^All/ }))
    fireEvent.click(screen.getByLabelText('Resubmissions only'))
    expect(bodyRows()).toHaveLength(3)
    fireEvent.change(screen.getByLabelText('Search item, vendor or SKU'), { target: { value: 'nobody' } })
    expect(await screen.findByText('No items match these filters')).toBeTruthy()
  })

  it('opens an item in its review screen', async () => {
    renderRoute('/queue')
    fireEvent.click(await screen.findByRole('link', { name: 'Review Ajrakh Block-Print Kurta' }))
    expect(await screen.findByRole('heading', { name: 'Ajrakh Block-Print Kurta', level: 1 })).toBeTruthy()
    expect(await screen.findByText('4 of 14')).toBeTruthy()
  })
})
