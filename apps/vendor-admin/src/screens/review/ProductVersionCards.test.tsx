import { ThemeProvider } from '@mui/material'
import { neutral, theme } from '@shazlo/ui'
import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { ReactElement } from 'react'
import { describe, expect, it } from 'vitest'
import type * as M from '../../api/model'
import { isBold, isSecondary, isSemibold, rgb } from '../../test/style'
import { CompareCard, SizeChartCard, SizesCard } from './ProductDetails'
import { ProductPhotos } from './ProductPhotos'

// vendor-api does not keep named photo slots, try-on photos, stock or size charts yet (#288), so the
// screens never receive them from the real service. They are built and ready for when it does: these
// tests give the cards a product version that has all of it.
const TITLE = 'Ajrakh Block-Print Kurta'
const photo = (id: string, slot: NonNullable<M.ProductPhoto['slot']>): M.ProductPhoto => ({ id, url: `https://img.test/${id}.jpg`, slot })
const tryOn = (n: number): M.TryOnPhoto[] => Array.from({ length: n }, (_, i) => ({ id: `t${i + 1}`, url: `https://img.test/t${i + 1}.jpg` }))
const stock = (values: number[]): M.ProductVersion['variants'] => ['XS', 'S', 'M', 'L', 'XL'].slice(0, values.length).map((size, i) => ({ size, sku: `KS-AJR-014-${size}`, stock: values[i]! }))

function version(over: Partial<M.ProductVersion> = {}): M.ProductVersion {
  return {
    title: TITLE,
    description: 'Hand block-printed cotton, dyed with natural colours. Hand wash cold.',
    gender: 'women',
    product_type: 'Kurtas',
    main_colour: { name: 'Indigo', hex: '#2E3F6E' },
    other_colours: [{ name: 'Madder red', hex: '#8C2F25' }],
    material: 'Cotton (mul)',
    price_paise: 249_900,
    mrp_paise: 299_900,
    variants: stock([4, 8, 10, 6, 3]),
    photos: [photo('a', 'front'), photo('b', 'back'), photo('c', 'detail'), photo('d', 'worn'), photo('e', 'extra')],
    try_on_photos: tryOn(5),
    size_chart: null,
    ...over,
  }
}

const KURTAS: NonNullable<M.ProductVersion['size_chart']> = {
  kind: 'table',
  product_type: 'Kurtas',
  measurements: ['Chest', 'Waist', 'Length', 'Shoulder'],
  rows: [
    { size: 'XS', cm: [86, 76, 104, null] },
    { size: 'M', cm: [96, 86, 106, 36.5] },
  ],
}

const show = (ui: ReactElement) => render(<ThemeProvider theme={theme}>{ui}</ThemeProvider>)

// A reference table's header row: semibold on the muted fill, over a firm rule.
function expectHeaderRow(table: HTMLElement) {
  for (const th of within(table).getAllByRole('columnheader')) {
    expect(isSemibold(th)).toBe(true)
    expect(getComputedStyle(th).backgroundColor).toBe(rgb(neutral.muted))
    expect(getComputedStyle(th).borderBottomWidth).toBe('2px')
    expect(getComputedStyle(th).borderBottomColor).toBe(rgb(neutral.lineStrong))
  }
}

describe('Photos, when the server names the slots and keeps try-on photos', () => {
  it('shows the product photos and the try-on photos by name, tags new ones and switches the main photo', async () => {
    const user = userEvent.setup()
    const before = version({ photos: [photo('a', 'front'), photo('c', 'detail'), photo('d', 'worn'), photo('e', 'extra')], try_on_photos: tryOn(3) })
    show(<ProductPhotos title={TITLE} version={version()} compareTo={before} />)
    const photos = screen.getByRole('region', { name: 'Photos' })
    expect(within(photos).getByRole('img', { name: `Front photo of ${TITLE}` })).toBeInTheDocument()

    const product = within(photos).getByRole('group', { name: 'Product photos' })
    expect(within(product).getAllByRole('button').map((b) => b.getAttribute('aria-label'))).toEqual(['Show front photo', 'Show back photo', 'Show detail photo', 'Show worn photo', 'Show extra photo'])
    expect(within(product).getByText('4 of 4 · 1 extra')).toBeInTheDocument()
    const front = within(product).getByRole('button', { name: 'Show front photo' })
    const back = within(product).getByRole('button', { name: 'Show back photo' })
    expect(front).toHaveAttribute('aria-pressed', 'true')
    expect(back).toHaveAccessibleDescription('New in this submission')
    expect(within(back).getByText('New')).toBeInTheDocument()
    expect(within(product).getByRole('button', { name: 'Show detail photo' })).not.toHaveAccessibleDescription()

    const group = within(photos).getByRole('group', { name: 'Try-on photos' })
    expect(within(group).getByText('Real people wearing it, so shoppers see the true fit.')).toBeInTheDocument()
    expect(within(group).getByText('5 of 5')).toBeInTheDocument()
    expect(within(group).getAllByRole('button')).toHaveLength(5)
    expect(within(group).getByRole('button', { name: 'Show try-on 3 photo' })).not.toHaveAccessibleDescription()
    expect(within(group).getByRole('button', { name: 'Show try-on 4 photo' })).toHaveAccessibleDescription('New in this submission')
    expect(within(photos).queryByText(/missing/)).toBeNull()

    await user.click(back)
    expect(within(photos).getByRole('img', { name: `Back photo of ${TITLE}` })).toBeInTheDocument()
    expect(back).toHaveAttribute('aria-pressed', 'true')
    expect(front).toHaveAttribute('aria-pressed', 'false')
    await user.click(within(group).getByRole('button', { name: 'Show try-on 2 photo' }))
    expect(within(photos).getByRole('img', { name: `Try-on 2 photo of ${TITLE}` })).toBeInTheDocument()
    expect(back).toHaveAttribute('aria-pressed', 'false')
  })

  it('flags a missing required photo', () => {
    show(<ProductPhotos title={TITLE} version={version({ photos: [photo('a', 'front'), photo('c', 'detail'), photo('d', 'worn')] })} compareTo={null} />)
    const photos = screen.getByRole('region', { name: 'Photos' })
    expect(within(photos).getByText('Back photo missing')).toBeInTheDocument()
    expect(within(photos).getByText('3 of 4')).toBeInTheDocument()
    expect(within(photos).getByText('Missing back photo. Every product needs front, back, detail and worn photos.')).toBeInTheDocument()
  })

  it('flags missing try-on photos', () => {
    show(<ProductPhotos title={TITLE} version={version({ try_on_photos: tryOn(2) })} compareTo={null} />)
    const group = within(screen.getByRole('region', { name: 'Photos' })).getByRole('group', { name: 'Try-on photos' })
    expect(within(group).getByText('2 of 5')).toBeInTheDocument()
    expect(within(group).getAllByRole('button')).toHaveLength(2)
    for (const n of [3, 4, 5]) expect(within(group).getByText(`Try-on ${n} photo missing`)).toBeInTheDocument()
    expect(within(group).getByText('3 of 5 try-on photos missing. Every product needs 5 photos of real people wearing it.')).toBeInTheDocument()
  })

  it('reports no try-on photos as missing when none are kept at all', () => {
    show(<ProductPhotos title={TITLE} version={version({ try_on_photos: null })} compareTo={null} />)
    expect(screen.queryByRole('group', { name: 'Try-on photos' })).toBeNull()
  })

  it('names photos the server keeps in order only "Photo 1", "Photo 2", and reports no slot missing', () => {
    show(<ProductPhotos title={TITLE} version={version({ photos: [photo('a', 'front'), photo('b', 'back')].map((p) => ({ ...p, slot: null })), try_on_photos: null })} compareTo={null} />)
    const product = within(screen.getByRole('region', { name: 'Photos' })).getByRole('group', { name: 'Product photos' })
    expect(within(product).getAllByRole('button').map((b) => b.getAttribute('aria-label'))).toEqual(['Show photo 1', 'Show photo 2'])
    expect(within(product).getByText('2 photos')).toBeInTheDocument()
    expect(screen.queryByText(/missing/i)).toBeNull()
  })
})

describe('Comparison, when the server keeps stock and try-on photos', () => {
  it('compares with the sent-back version and marks the rows that changed', () => {
    const before = version({ photos: [photo('a', 'front'), photo('c', 'detail'), photo('d', 'worn'), photo('e', 'extra')], try_on_photos: tryOn(3), variants: stock([4, 8, 10, 6, 0]) })
    show(<CompareCard label="sent_back" before={before} after={version()} />)
    const table = within(screen.getByRole('region', { name: /^Compared with the/ })).getByRole('table')
    const row = (field: RegExp) => within(table).getByRole('rowheader', { name: field }).closest('tr')!
    const cells = (r: HTMLElement) => within(r).getAllByRole('cell').map((c) => c.textContent)
    expect(within(table).getAllByRole('columnheader').map((c) => c.textContent)).toEqual(['Field', 'Sent-back version', 'This submission'])
    expect(within(table).getAllByText('Changed')).toHaveLength(3)
    expect(cells(row(/^Product photos/))).toEqual(['Front, detail, worn, extra', 'Front, back, detail, worn, extra'])
    expect(cells(row(/^Try-on photos/))).toEqual(['3 photos', '5 photos'])
    expect(cells(row(/^Sizes and stock/))).toEqual(['XS 4 · S 8 · M 10 · L 6 · XL 0', 'XS 4 · S 8 · M 10 · L 6 · XL 3'])
    expect(cells(row(/^Title/))).toEqual([TITLE, 'Same'])
    expect(cells(row(/^Colours/))).toEqual(['Indigo, also Madder red', 'Same'])
  })

  it('compares sizes without stock by their names only', () => {
    const noStock = (v: M.ProductVersion) => ({ ...v, variants: v.variants.map((x) => ({ ...x, stock: null })), try_on_photos: null })
    show(<CompareCard label="live" before={noStock(version())} after={noStock(version({ variants: stock([1, 1, 1]) }))} />)
    const table = within(screen.getByRole('region', { name: /^Compared with the/ })).getByRole('table')
    const sizes = within(table).getByRole('rowheader', { name: /^Sizes and stock/ }).closest('tr')!
    expect(within(sizes).getAllByRole('cell').map((c) => c.textContent)).toEqual(['XS · S · M · L · XL', 'XS · S · M'])
  })
})

describe('Sizes and stock, when the server keeps stock', () => {
  it('sets the table apart: a muted header row, semibold sizes, mono codes, right-aligned stock and a bold total', () => {
    show(<SizesCard version={version()} />)
    const table = within(screen.getByRole('region', { name: 'Sizes and stock' })).getByRole('table')
    expectHeaderRow(table)
    expect(within(table).getAllByRole('columnheader').map((c) => c.textContent)).toEqual(['Size', 'Code', 'Stock'])
    expect(getComputedStyle(within(table).getByRole('columnheader', { name: 'Stock' })).textAlign).toBe('right')

    const xl = within(table).getByRole('rowheader', { name: 'XL' })
    expect(isSemibold(xl)).toBe(true)
    const [code, stockCell] = within(xl.closest('tr')!).getAllByRole('cell')
    expect(code!.textContent).toBe('KS-AJR-014-XL')
    expect(stockCell!.textContent).toBe('3')
    expect(getComputedStyle(code!).fontFamily).toMatch(/monospace/)
    expect(isSecondary(code!)).toBe(true)
    expect(getComputedStyle(stockCell!).textAlign).toBe('right')
    expect(getComputedStyle(xl).borderBottomColor).toBe(rgb(neutral.line))

    // The total reads as a total: bold, over a firm rule.
    const total = within(table).getByRole('rowheader', { name: 'Total' })
    const totalRow = total.closest('tr')!
    expect(totalRow).toHaveAttribute('data-total')
    expect(within(totalRow).getAllByRole('cell').map((c) => c.textContent)).toEqual(['', '31'])
    for (const cell of [total, ...within(totalRow).getAllByRole('cell')]) {
      expect(getComputedStyle(cell).borderTopWidth).toBe('2px')
      expect(getComputedStyle(cell).borderTopColor).toBe(rgb(neutral.lineStrong))
    }
    expect(isBold(total)).toBe(true)
    expect(isBold(within(totalRow).getByText('31'))).toBe(true)
  })

  it('shows a dash for a size with no stock figure, and counts only the figures it has', () => {
    show(<SizesCard version={version({ variants: [{ size: 'S', sku: 'A-S', stock: 5 }, { size: 'M', sku: 'A-M', stock: null }] })} />)
    const table = within(screen.getByRole('region', { name: 'Sizes and stock' })).getByRole('table')
    expect(within(within(table).getByRole('rowheader', { name: 'M' }).closest('tr')!).getAllByRole('cell').map((c) => c.textContent)).toEqual(['A-M', '—'])
    expect(within(within(table).getByRole('rowheader', { name: 'Total' }).closest('tr')!).getAllByRole('cell').map((c) => c.textContent)).toEqual(['', '5'])
  })

  it('leaves the stock column and the total out when the server keeps none', () => {
    show(<SizesCard version={version({ variants: stock([1, 1]).map((v) => ({ ...v, stock: null })) })} />)
    const table = within(screen.getByRole('region', { name: 'Sizes and stock' })).getByRole('table')
    expect(within(table).getAllByRole('columnheader').map((c) => c.textContent)).toEqual(['Size', 'Code'])
    expect(within(table).queryByRole('rowheader', { name: 'Total' })).toBeNull()
  })
})

describe('Size chart, when the server has one for the vendor', () => {
  it('shows the size chart the brand saved for kurtas, in cm', () => {
    show(<SizeChartCard chart={KURTAS} />)
    const chart = screen.getByRole('region', { name: 'Size chart' })
    expect(within(chart).getByText('Used for all their kurtas. Measurements in cm.')).toBeInTheDocument()
    const table = within(chart).getByRole('table')
    // Each measurement column names its unit.
    expect(within(table).getAllByRole('columnheader').map((c) => c.textContent)).toEqual(['Size', 'Chest (cm)', 'Waist (cm)', 'Length (cm)', 'Shoulder (cm)'])
    expect(within(within(table).getByRole('rowheader', { name: 'XS' }).closest('tr')!).getAllByRole('cell').map((c) => c.textContent)).toEqual(['86', '76', '104', '—'])
    expect(within(within(table).getByRole('rowheader', { name: 'M' }).closest('tr')!).getAllByRole('cell').map((c) => c.textContent)).toEqual(['96', '86', '106', '36.5'])
  })

  it('sets the size chart apart: a muted header row, size labels in semibold, a rule between columns', () => {
    show(<SizeChartCard chart={KURTAS} />)
    const table = within(screen.getByRole('region', { name: 'Size chart' })).getByRole('table')
    expectHeaderRow(table)
    const chest = within(table).getByRole('columnheader', { name: 'Chest (cm)' })
    expect(isSecondary(within(chest).getByText('(cm)'))).toBe(true)
    const m = within(table).getByRole('rowheader', { name: 'M' })
    expect(isSemibold(m)).toBe(true)
    const lastRow = within(table).getAllByRole('row').at(-1)
    for (const cell of within(m.closest('tr')!).getAllByRole('cell')) {
      expect(getComputedStyle(cell).borderLeftColor).toBe(rgb(neutral.line))
      expect(getComputedStyle(cell).textAlign).toBe('right')
    }
    expect(getComputedStyle(within(lastRow!).getAllByRole('cell')[0]!).borderBottomWidth).toMatch(/^0(px)?$/)
  })

  it('shows a size chart photo', () => {
    show(<SizeChartCard chart={{ kind: 'photo', product_type: 'Shirts', url: 'https://img.test/chart.jpg' }} />)
    const chart = screen.getByRole('region', { name: 'Size chart' })
    expect(within(chart).getByRole('img', { name: 'The brand’s size chart for shirts' })).toBeInTheDocument()
    expect(within(chart).getByText('Used for all their shirts. A photo of their own chart.')).toBeInTheDocument()
  })
})
