import { configure, fireEvent, screen, within } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { renderRoute } from '../../test/render'

// The first render of a file pays for loading MUI and the kit; give async queries room.
configure({ asyncUtilTimeout: 5000 })
vi.setConfig({ testTimeout: 20_000 })

describe('V-08 Bulk import', () => {
  it('shows the validation report after choosing a file, then creates the drafts', async () => {
    renderRoute('/products/import')
    expect(await screen.findByText('Drop your filled-in template here')).toBeTruthy()

    const file = new File(['Product ID,Product name\nKS-1,Kurta\n'], 'kalki_catalog_oct.xlsx', { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' })
    fireEvent.change(screen.getByTestId('import-file'), { target: { files: [file] } })

    expect(await screen.findByText('5 rows need fixing')).toBeTruthy()
    expect(screen.getByText('kalki_catalog_oct.xlsx')).toBeTruthy()
    const table = screen.getByRole('table', { name: 'Rows that need fixing' })
    expect(within(table).getAllByRole('row')).toHaveLength(6)
    expect(within(table).getByText('Required. Add a product name.')).toBeTruthy()

    fireEvent.click(screen.getByRole('button', { name: 'Create 47 drafts' }))
    expect(await screen.findByText('47 drafts created')).toBeTruthy()
  })

  it('explains a file it cannot read', async () => {
    renderRoute('/products/import')
    await screen.findByText('Drop your filled-in template here')
    fireEvent.change(screen.getByTestId('import-file'), { target: { files: [new File(['x'], 'catalog.pdf', { type: 'application/pdf' })] } })
    expect(await screen.findByText(/catalog\.pdf isn’t a spreadsheet/)).toBeTruthy()
  })
})
