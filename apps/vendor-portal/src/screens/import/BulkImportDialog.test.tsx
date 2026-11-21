import { configure, fireEvent, screen, waitFor, within } from '@testing-library/react'
import { http, HttpResponse } from 'msw'
import { File as NodeFile } from 'node:buffer'
import { beforeAll, describe, expect, it, onTestFinished, vi } from 'vitest'
import { DEMO_STAFF, type MockDb } from '../../mocks/db'
import { IMPORT_COLUMNS } from '../../lib/catalog'
import { renderApp } from '../../test/render'
import { setupMockApi } from '../../test/server'
import { planImportPhotos } from './photoPlan'

// V-08 Bulk import against the mock vendor-api: the template, a check that writes nothing
// (`mode=validate`), the rows to fix, then the drafts (`mode=import`) and their photos through the
// sign → Cloudinary → register pipeline.

type User = Awaited<ReturnType<typeof renderApp>>['user']

// The first test also loads the Products and wizard chunks; give async queries room on slow machines.
configure({ asyncUtilTimeout: 8000, defaultHidden: true })

// jsdom's object URLs (src/test/setup.ts) have no origin, so SafeImage refuses them; a browser's
// look like blob:http://localhost/…. Set before the mock database makes its demo photos.
vi.hoisted(() => {
  let n = 0
  URL.createObjectURL = () => `blob:http://localhost/${(n += 1)}`
})

const { server, db: mockDb } = setupMockApi()

// The spreadsheet goes up with fetch, which (Node's) takes only Node's File; photos go up with
// XMLHttpRequest and jsdom's FormData, which take only jsdom's.
const sheet = (text: string, name = 'products.csv', type = 'text/csv') => new NodeFile([text], name, { type }) as unknown as File
const jpeg = (name: string) => new File([new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0, 16])], name, { type: 'image/jpeg' })

const HEADER = IMPORT_COLUMNS.join(',')

// Three good rows; then a bad price, a missing name, and a row with an unknown type and unreadable sizes.
const MIXED_CSV = [
  HEADER,
  'Relaxed Linen Shirt,Men,Shirts,Beige,White,1899,"S:4, M:6, L:3, XL:0",Relaxed shirt in washed linen.,100% linen,2499',
  'Indigo Test Kurta,Women,kurta,Indigo,"Red, Black",1499,"S:2, M:3",Hand block-printed.,Cotton mul,1799',
  'Rust Test Trousers,Women,Trousers,Rust,,1299,"28:3, 30:4",Wide-leg trousers.,Cotton,',
  'Bagru Test Palazzo,Women,Palazzos,Beige,,"1,299/-",S:4,Easy palazzo.,Cotton,',
  ',Women,Kurtas,Indigo,,999,M:2,A kurta.,Cotton,',
  'Mashru Test Stole,Women,Shawls & wraps,Mustard,,899,M 6,A stole.,Silk,',
].join('\n')

const CLEAN_CSV = [
  HEADER,
  'Chanderi Clean Kurta,Women,Kurtas,Sage,,2199,"S:2, M:2",Chanderi kurta.,Chanderi silk-cotton,2499',
  'Khadi Clean Shirt,Men,Shirts,Ivory,,1599,"M:3, L:3",Khadi shirt.,Khadi cotton,',
].join('\n')

const titles = (db: MockDb) => db.products.map((p) => (p.working ?? p.live)!.content.title)
const contentOf = (db: MockDb, title: string) => {
  const p = db.products.find((r) => (r.working ?? r.live)!.content.title === title)!
  return { record: p, content: (p.working ?? p.live)!.content }
}

async function openWizard(options: { viewport?: 'desktop' | 'mobile'; credentials?: { email: string; password: string } } = {}) {
  const app = await renderApp({ route: '/products/import', ...options })
  const dialog = await screen.findByRole('dialog', { name: 'Bulk import' })
  return { ...app, dialog }
}

async function toUpload(user: User, dialog: HTMLElement) {
  await user.click(within(dialog).getByRole('button', { name: 'I already have a file' }))
  return within(dialog).findByText(/Drop your .xlsx or .csv here/)
}

async function upload(user: User, f: File) {
  await user.upload(screen.getByLabelText('Spreadsheet file'), f)
}

function stat(dialog: HTMLElement, label: string) {
  return within(dialog).getByRole('group', { name: label })
}

/** The import requests made, by mode. */
function importRequests() {
  const modes: string[] = []
  const listener = ({ request }: { request: Request }) => {
    const url = new URL(request.url)
    if (request.method === 'POST' && url.pathname === '/v1/vendor/products/import') modes.push(url.searchParams.get('mode') ?? '')
  }
  server.events.on('request:start', listener)
  onTestFinished(() => {
    server.events.removeListener('request:start', listener)
  })
  return modes
}

// Saving a file goes through a Blob URL and a temporary download link.
function captureDownloads() {
  const blobs: Blob[] = []
  vi.spyOn(URL, 'createObjectURL').mockImplementation((blob) => {
    blobs.push(blob as Blob)
    return `blob:http://localhost/download-${blobs.length}`
  })
  vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {})
  const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {})
  const names = () => click.mock.contexts.map((a) => (a as HTMLAnchorElement).download)
  return { blobs, names }
}

describe('V-08 Bulk import', { timeout: 60_000 }, () => {
  // The route and the wizard are lazy chunks; load them before the first test is timed.
  beforeAll(async () => {
    await import('../products/ProductList')
    await import('./BulkImportDialog')
  }, 120_000)

  it('opens as a wizard over Products with the 10 template columns and the example row', async () => {
    const { user, router, dialog } = await openWizard()
    expect(dialog).toHaveTextContent('Add many products at once from a spreadsheet. They are saved as drafts; nothing goes live until our team reviews it.')
    expect(screen.getByRole('heading', { level: 1, name: 'Products', hidden: true })).toBeInTheDocument()
    for (const step of ['Download template', 'Upload file', 'Fix errors', 'Add photos']) {
      expect(within(dialog).getAllByText(step).length).toBeGreaterThan(0)
    }

    const guide = within(dialog).getByRole('list', { name: 'Template columns' })
    const columns = within(guide).getAllByRole('listitem').map((li) => li.textContent)
    expect(columns).toEqual([
      'Product nameproduct_nameRelaxed Linen ShirtRequired',
      'GendergenderMenRequired',
      'Product typeproduct_typeShirtsRequired',
      'Main colourmain_colourBeigeRequired',
      'Other coloursother_coloursWhiteOptional',
      'Selling priceselling_price1899Required',
      'Sizes and stocksizes_stockS:4, M:6, L:3, XL:0Required',
      'DescriptiondescriptionRelaxed shirt in washed linen with a camp collar. Machine wash cold.Required',
      'Materialmaterial100% linenRequired',
      'MRPmrp2499Optional',
    ])
    // The column keys are set in the theme's monospace face (no font named in the app).
    expect(within(guide).getByText('product_name').tagName).toBe('SPAN')
    expect(dialog).toHaveTextContent('Sizes and stock: Write each size and how many you have, like S:4, M:6, L:3, XL:0. Use 0 for a sold-out size.')
    expect(dialog).not.toHaveTextContent(/SKU|catalogue|Product ID|Image 1/)

    await user.click(within(dialog).getByRole('button', { name: 'Close' }))
    await waitFor(() => expect(router.state.location.pathname).toBe('/products'))
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
  })

  it('opens from the Bulk import button on Products', async () => {
    const { user, router } = await renderApp({ route: '/products?status=draft' })
    await user.click(await within(await screen.findByRole('main')).findByRole('link', { name: 'Bulk import' }))
    expect(await screen.findByRole('dialog', { name: 'Bulk import' })).toBeInTheDocument()
    expect(router.state.location.pathname).toBe('/products/import')
    await user.keyboard('{Escape}')
    await waitFor(() => expect(router.state.location.pathname).toBe('/products'))
    expect(router.state.location.search).toBe('?status=draft')
  })

  it('downloads the template as a CSV and says so on the upload step', async () => {
    const downloads = captureDownloads()
    const { user, dialog } = await openWizard()
    await user.click(within(dialog).getByRole('button', { name: 'Download template' }))
    await waitFor(() => expect(downloads.blobs).toHaveLength(1))
    expect(downloads.names()).toEqual(['shazlo-products-template.csv'])
    expect(await downloads.blobs[0]!.text()).toMatch(/^product_name,gender,product_type,main_colour,other_colours,selling_price,sizes_stock,description,material,mrp\n/)
    expect(await within(dialog).findByText(/Drop your .xlsx or .csv here/)).toBeInTheDocument()
    expect(within(dialog).getByText('Template downloaded. Fill it in, then upload it here.')).toBeInTheDocument()
  })

  it('says when the template did not download', async () => {
    mockDb().faults.push({ path: '/v1/vendor/products/import/template', network: true })
    const { user, dialog } = await openWizard()
    await user.click(within(dialog).getByRole('button', { name: 'Download template' }))
    expect(await within(dialog).findByText('The template did not download. Check your connection and try again.')).toBeInTheDocument()
  })

  it('opens the file picker from the keyboard, and asks for .csv or .xlsx up to 2 MB', async () => {
    const { user, dialog } = await openWizard()
    await toUpload(user, dialog)
    const input = screen.getByLabelText('Spreadsheet file') as HTMLInputElement
    expect(input).toHaveAttribute('accept', '.csv,.xlsx,text/csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet')
    expect(dialog).toHaveTextContent('A .xlsx or .csv file up to 2 MB, with at most 1,000 rows.')
    const pick = vi.spyOn(input, 'click').mockImplementation(() => {})
    within(dialog).getByRole('button', { name: 'choose a file' }).focus()
    await user.keyboard('{Enter}')
    expect(pick).toHaveBeenCalled()
  })

  it('checks a CSV row by row, makes nothing yet, and says what to fix in plain words, with the column and product', async () => {
    const downloads = captureDownloads()
    const modes = importRequests()
    const { user, dialog, db } = await openWizard()
    const before = db.products.length
    await toUpload(user, dialog)
    await upload(user, sheet(MIXED_CSV))

    expect(await within(dialog).findByText('products.csv')).toBeInTheDocument()
    // Only checked: nothing is made until the seller saves.
    expect(modes).toEqual(['validate'])
    expect(db.products).toHaveLength(before)

    expect(within(dialog).getByText('6 rows')).toBeInTheDocument()
    expect(stat(dialog, 'Rows in file')).toHaveTextContent('6')
    expect(stat(dialog, 'Ready')).toHaveTextContent('3Will be saved as drafts')
    expect(stat(dialog, 'Need fixing')).toHaveTextContent('3Listed below')

    const table = within(dialog).getByRole('table', { name: '3 rows need fixing' })
    expect(within(table).getAllByRole('columnheader').map((h) => h.textContent)).toEqual(['Row', 'Product', 'Column', 'What to fix'])
    const rows = within(table).getAllByRole('row').slice(1)
    expect(rows.map((r) => within(r).getAllByRole('cell').map((c) => c.textContent))).toEqual([
      ['5', 'Bagru Test Palazzo', 'Selling price', 'Must be a number above 0, like 1299. Found "1,299/-".'],
      ['6', '—', 'Product name', 'Required. Add a product name.'],
      ['7', 'Mashru Test Stole', 'Product type', '"Shawls & wraps" is not a product type we list. Closest match: Stoles.'],
      ['7', 'Mashru Test Stole', 'Sizes and stock', 'Could not read "M 6". Write each size and its stock, like S:4, M:6, L:3.'],
    ])
    expect(within(dialog).getByText('4 problems')).toBeInTheDocument()
    expect(dialog).toHaveTextContent('3 products will be saved as drafts. Next, you can add their photos.')

    await user.click(within(dialog).getByRole('button', { name: 'Download what to fix' }))
    await waitFor(() => expect(downloads.blobs).toHaveLength(1))
    expect(downloads.names()).toEqual(['products-fixes.csv'])
    const report = (await downloads.blobs[0]!.text()).replace(/^\uFEFF/, '').split('\r\n')
    expect(report[0]).toBe('Row,Product,Column,What to fix')
    expect(report[1]).toBe('5,Bagru Test Palazzo,Selling price,"Must be a number above 0, like 1299. Found ""1,299/-""."')
    expect(report[2]).toBe('6,,Product name,Required. Add a product name.')
  })

  it('filters a long list of problems by column and words, a page at a time, and says when it was cut short', async () => {
    const errors = Array.from({ length: 30 }, (_, i) => ({ row: i + 2, column: i % 3 === 0 ? 'gender' : 'selling_price', code: 'invalid_value', message: i % 3 === 0 ? 'Use Women, Men or Unisex.' : `Price ${i} is not a number.` }))
    server.use(
      http.post('*/v1/vendor/products/import', () =>
        HttpResponse.json({
          mode: 'validate',
          file_format: 'csv',
          committed: false,
          summary: { products: 40, created: 0, unchanged: 0, valid: 10, rejected: 30, rows_read: 40, rows_with_errors: 30 },
          ignored_columns: [],
          products: [],
          errors,
          errors_truncated: true,
        }),
      ),
    )
    const { user, dialog } = await openWizard()
    await toUpload(user, dialog)
    await upload(user, sheet(MIXED_CSV, 'big.csv'))
    const table = await within(dialog).findByRole('table', { name: '30 rows need fixing' })
    expect(within(dialog).getByRole('alert')).toHaveTextContent('There are more problems than we can list. Here are the first 30.')
    expect(within(table).getAllByRole('row')).toHaveLength(26)
    expect(within(dialog).getByText('Showing 1–25 of 30')).toBeInTheDocument()
    await user.click(within(dialog).getByRole('button', { name: 'Next' }))
    expect(within(table).getAllByRole('row')).toHaveLength(6)

    await user.click(within(dialog).getByRole('combobox', { name: 'Column' }))
    await user.click(await screen.findByRole('option', { name: 'Gender' }))
    expect(within(dialog).getByText('10 of 30 problems match')).toBeInTheDocument()
    expect(within(dialog).queryByText(/^Showing/)).toBeNull()
    await user.type(within(dialog).getByLabelText('Search what to fix'), '11')
    expect(within(dialog).getByText('1 of 30 problems match')).toBeInTheDocument()
    await user.type(within(dialog).getByLabelText('Search what to fix'), 'zzz')
    expect(within(dialog).getByText('No problems match. Clear the search or choose another column.')).toBeInTheDocument()
  })

  it('says which products are already there and which columns were left out', async () => {
    const { user, dialog } = await openWizard()
    await toUpload(user, dialog)
    const csv = [
      `${HEADER},notes`,
      'Ajrakh Block-Print Kurta,Women,Kurtas,Indigo,,2499,"S:4",Ajrakh kurta.,Cotton mul,2999,again',
      'Chanderi Clean Kurta,Women,Kurtas,Sage,,2199,"S:2, M:2",Chanderi kurta.,Chanderi silk-cotton,2499,',
    ].join('\n')
    await upload(user, sheet(csv))
    expect(await within(dialog).findByText('All 2 rows are ready')).toBeInTheDocument()
    expect(dialog).toHaveTextContent('1 product is already in your products and will stay as it is.')
    expect(dialog).toHaveTextContent('These columns are not in the template and were left out: notes.')
    expect(within(dialog).getByRole('button', { name: 'Save 1 draft' })).toBeInTheDocument()
  })

  it('saves the good rows as drafts once, however fast the button is pressed, then matches photos to them by name and uploads them', async () => {
    const modes = importRequests()
    const { user, dialog, db, router } = await openWizard()
    await toUpload(user, dialog)
    await upload(user, sheet(MIXED_CSV))
    await user.dblClick(await within(dialog).findByRole('button', { name: 'Save 3 drafts' }))

    expect(await within(dialog).findByText('3 drafts saved')).toBeInTheDocument()
    expect(modes).toEqual(['validate', 'import'])
    expect(within(dialog).getByText('Step 4 of 4: Add photos')).toBeInTheDocument()
    const shirt = contentOf(db, 'Relaxed Linen Shirt')
    const kurta = contentOf(db, 'Indigo Test Kurta')
    expect([shirt.record.status, kurta.record.status]).toEqual(['draft', 'draft'])
    expect(shirt.content).toMatchObject({ gender: 'men', category: 'shirts', main_colour: 'Beige', other_colours: ['White'], fabric: '100% linen' })
    expect(shirt.content.variants[0]).toMatchObject({ price_paise: 189900, mrp_paise: 249900 })
    expect(kurta.content.category).toBe('kurtas')
    expect(titles(db).filter((t) => t === 'Relaxed Linen Shirt')).toHaveLength(1)

    const input = within(dialog).getByLabelText('Photo files')
    expect(input).toHaveAttribute('multiple')
    expect(input).not.toHaveAttribute('capture')
    await user.upload(input, [
      jpeg('Relaxed Linen Shirt - front.jpg'),
      jpeg('Indigo Test Kurta.jpg'),
      jpeg('Relaxed Linen Shirt - back.jpg'),
      jpeg('Relaxed Linen Shirt_tryon2.jpg'),
      jpeg('IMG_2231.jpg'),
      new File(['notes'], 'notes.txt', { type: 'text/plain' }),
    ])
    const matched = within(dialog).getByRole('list', { name: 'Matched photos' })
    expect(within(matched).getAllByRole('listitem').map((li) => li.textContent)).toEqual([
      'Relaxed Linen Shirt - front.jpg → Relaxed Linen Shirt, FrontReady to add',
      'Relaxed Linen Shirt - back.jpg → Relaxed Linen Shirt, BackReady to add',
      'Relaxed Linen Shirt_tryon2.jpg → Relaxed Linen Shirt, Try-on 1Ready to add',
      'Indigo Test Kurta.jpg → Indigo Test Kurta, FrontReady to add',
    ])
    expect(within(dialog).getByText('1 photo did not match a product')).toBeInTheDocument()
    expect(within(within(dialog).getByRole('list', { name: 'Photos that did not match' })).getByText('IMG_2231.jpg')).toBeInTheDocument()

    // The first upload fails; it says why and can be tried again.
    db.faults.push({ path: '/v1/vendor/assets/sign', method: 'POST', network: true })
    await user.click(within(dialog).getByRole('button', { name: 'Add 4 photos' }))
    expect(await within(dialog).findByText('1 photo did not upload. Try them again, or add them later from each product.')).toBeInTheDocument()
    expect(within(matched).getAllByRole('listitem')[0]).toHaveTextContent('Could not reach the server. Check your connection and try again.')
    expect(within(dialog).getByText('3 of 4 photos added')).toBeInTheDocument()
    await user.click(within(dialog).getByRole('button', { name: 'Try again: Relaxed Linen Shirt - front.jpg' }))
    expect(await within(dialog).findByText('4 photos added. Check each draft, then send it for review from Products.')).toBeInTheDocument()

    const angles = (title: string) => contentOf(db, title).content.images.map((i) => i.angle).sort()
    expect(angles('Relaxed Linen Shirt')).toEqual(['back', 'front', 'tryon'])
    expect(angles('Indigo Test Kurta')).toEqual(['front'])

    await user.click(within(dialog).getByRole('button', { name: 'View drafts' }))
    await waitFor(() => expect(router.state.location.pathname).toBe('/products'))
    expect(router.state.location.search).toBe('?status=draft')
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
    expect(await screen.findByRole('tab', { name: 'Drafts 6' })).toHaveAttribute('aria-selected', 'true')
    expect(await screen.findByRole('link', { name: 'Relaxed Linen Shirt' })).toBeInTheDocument()
  })

  it('lets the seller skip photos and go to the drafts', async () => {
    const { user, dialog, router } = await openWizard()
    await toUpload(user, dialog)
    await upload(user, sheet(CLEAN_CSV, 'fixed.csv'))
    expect(await within(dialog).findByText('All 2 rows are ready')).toBeInTheDocument()
    await user.click(within(dialog).getByRole('button', { name: 'Save 2 drafts' }))
    await user.click(await within(dialog).findByRole('button', { name: 'Add photos later' }))
    await waitFor(() => expect(router.state.location.search).toBe('?status=draft'))
  })

  it('says plainly when the drafts could not be saved, and that nothing else changed', async () => {
    const { user, dialog, db } = await openWizard()
    await toUpload(user, dialog)
    await upload(user, sheet(CLEAN_CSV))
    const before = db.products.length
    db.faults.push({ path: '/v1/vendor/products/import', method: 'POST', status: 503, code: 'unavailable', message: 'Down for a moment.' })
    await user.click(await within(dialog).findByRole('button', { name: 'Save 2 drafts' }))
    expect(await within(dialog).findByText('Something went wrong on our side. Nothing was saved. Try again in a moment.')).toBeInTheDocument()
    expect(db.products).toHaveLength(before)
    // It can be saved once the service is back.
    await user.click(within(dialog).getByRole('button', { name: 'Save 2 drafts' }))
    expect(await within(dialog).findByText('2 drafts saved')).toBeInTheDocument()
  })

  it('lets the seller replace the file', async () => {
    const { user, dialog } = await openWizard()
    await toUpload(user, dialog)
    await upload(user, sheet(MIXED_CSV))
    expect(await within(dialog).findByRole('table', { name: '3 rows need fixing' })).toBeInTheDocument()
    expect(within(dialog).getByRole('button', { name: 'Save 3 drafts' })).toBeEnabled()

    await user.click(within(dialog).getByRole('button', { name: 'Upload fixed file' }))
    expect(await within(dialog).findByText(/Drop your .xlsx or .csv here/)).toBeInTheDocument()
    await upload(user, sheet(CLEAN_CSV, 'fixed.csv'))
    expect(await within(dialog).findByText('All 2 rows are ready')).toBeInTheDocument()
    expect(within(dialog).getByText('fixed.csv')).toBeInTheDocument()
    expect(within(dialog).queryByRole('table')).toBeNull()
    expect(within(dialog).queryByRole('button', { name: 'Upload fixed file' })).toBeNull()

    await user.click(within(dialog).getByRole('button', { name: 'Replace file' }))
    expect(await within(dialog).findByText(/Drop your .xlsx or .csv here/)).toBeInTheDocument()
  })

  it('refuses a file that is not a spreadsheet, an empty one and an old .xls, before sending anything', async () => {
    const modes = importRequests()
    const { user, dialog } = await openWizard()
    await toUpload(user, dialog)
    const zone = within(dialog).getByText(/Drop your .xlsx or .csv here/).closest('[data-dropzone]')!
    fireEvent.drop(zone, { dataTransfer: { files: [sheet('%PDF', 'lookbook.pdf', 'application/pdf')], types: ['Files'] } })
    expect(await within(dialog).findByRole('alert')).toHaveTextContent('Upload the template as .xlsx or .csv.')
    fireEvent.drop(zone, { dataTransfer: { files: [sheet('', 'products.csv')], types: ['Files'] } })
    expect(await within(dialog).findByRole('alert')).toHaveTextContent('This file is empty. Choose the file with your products.')
    fireEvent.drop(zone, { dataTransfer: { files: [sheet('x', 'old.xls', 'application/vnd.ms-excel')], types: ['Files'] } })
    expect(await within(dialog).findByRole('alert')).toHaveTextContent('Upload the template as .xlsx or .csv.')
    expect(modes).toEqual([])
    expect(within(dialog).getByText(/Drop your .xlsx or .csv here/)).toBeInTheDocument()

    // A good file afterwards clears the message.
    await upload(user, sheet(CLEAN_CSV))
    expect(await within(dialog).findByText('All 2 rows are ready')).toBeInTheDocument()
    expect(within(dialog).queryByRole('alert')).toBeNull()
  })

  it('refuses a file over 2 MB before sending it, and words vendor-api\'s own refusals', async () => {
    const modes = importRequests()
    const { user, dialog, db } = await openWizard()
    await toUpload(user, dialog)
    const big = sheet(`${HEADER}\n${'x'.repeat(2 * 1024 * 1024)}`, 'huge.csv')
    await upload(user, big)
    expect(await within(dialog).findByRole('alert')).toHaveTextContent('This file is 2 MB; files can be up to 2 MB. Split it into smaller files and upload each one.')
    expect(modes).toEqual([])

    // More than 1,000 rows: only vendor-api can count them.
    const row = CLEAN_CSV.split('\n')[1]!
    await upload(user, sheet([HEADER, ...Array.from({ length: 1001 }, (_, i) => row.replace('Chanderi Clean Kurta', `Kurta ${i}`))].join('\n'), 'long.csv'))
    expect(await within(dialog).findByRole('alert')).toHaveTextContent('This file has more than 1,000 rows. Split it into smaller files and upload each one.')

    // A sheet without the template's columns.
    await upload(user, sheet('name,price\nShirt,1', 'other.csv'))
    expect(await within(dialog).findByRole('alert')).toHaveTextContent(/^We could not read this file\. The file has no column named .+ Compare it with the template\.$/)

    // vendor-api set up with a lower limit than the portal knows.
    db.faults.push({ path: '/v1/vendor/products/import', method: 'POST', status: 413, code: 'file_too_large', message: 'The file is larger than 512 KB. Split it in parts' })
    await upload(user, sheet(CLEAN_CSV))
    expect(await within(dialog).findByRole('alert')).toHaveTextContent('This file is too large; files can be up to 2 MB. Split it into smaller files and upload each one.')

    db.faults.push({ path: '/v1/vendor/products/import', method: 'POST', network: true })
    await upload(user, sheet(CLEAN_CSV))
    expect(await within(dialog).findByRole('alert')).toHaveTextContent('We could not reach Shazlo. Check your connection and try again.')
  })

  it('works the same for staff', async () => {
    const { user, dialog } = await openWizard({ credentials: DEMO_STAFF })
    await toUpload(user, dialog)
    await upload(user, sheet(CLEAN_CSV))
    await user.click(await within(dialog).findByRole('button', { name: 'Save 2 drafts' }))
    expect(await within(dialog).findByText('2 drafts saved')).toBeInTheDocument()
  })

  it('fills the screen on phones, says a laptop is easier, and lists the rows to fix', async () => {
    const { user, dialog } = await openWizard({ viewport: 'mobile' })
    expect(dialog.className).toMatch(/FullScreen/)
    expect(within(dialog).getByText('Step 1 of 4: Download template')).toBeInTheDocument()
    expect(within(dialog).getByText('Easier on a laptop')).toBeInTheDocument()
    expect(dialog).toHaveTextContent('Spreadsheets are hard to fill in and fix on a phone.')
    await toUpload(user, dialog)
    await upload(user, sheet(MIXED_CSV))
    const list = await within(dialog).findByRole('list', { name: '3 rows need fixing' })
    expect(within(list).getAllByRole('listitem')[0]).toHaveTextContent('Row 5 · Selling priceBagru Test Palazzo')
    expect(within(dialog).queryByRole('table')).toBeNull()
  })
})

describe('planImportPhotos', () => {
  const drafts = [
    { id: 'a', title: 'Relaxed Linen Shirt' },
    { id: 'b', title: 'Tie Back Dress' },
  ]
  const named = (...names: string[]) => names.map((n) => ({ name: n }) as File)

  it('places named slots first, fills the rest in order and keeps count across batches', () => {
    const first = planImportPhotos(named('Relaxed Linen Shirt 1.jpg', 'Relaxed Linen Shirt - front.jpg', 'Tie Back Dress.png', 'Relaxed Linen Shirt - extra.jpg'), drafts)
    // "Tie Back Dress" is a name, not the back slot.
    expect(first.matched.map((m) => [m.file.name, m.product.id, m.angle])).toEqual([
      ['Relaxed Linen Shirt - front.jpg', 'a', 'front'],
      ['Relaxed Linen Shirt - extra.jpg', 'a', 'extra'],
      ['Relaxed Linen Shirt 1.jpg', 'a', 'back'],
      ['Tie Back Dress.png', 'b', 'front'],
    ])
    // A second front for the same product takes the next empty slot instead.
    const second = planImportPhotos(named('Relaxed Linen Shirt front.jpg'), drafts, first.matched)
    expect(second.matched.map((m) => m.angle)).toEqual(['detail'])
  })

  it('caps try-on and extra photos and lists what did not match', () => {
    const tryons = named(...Array.from({ length: 6 }, (_, i) => `Relaxed Linen Shirt tryon${i + 1}.jpg`), 'random.jpg')
    const plan = planImportPhotos(tryons, drafts)
    expect(plan.matched.filter((m) => m.angle === 'tryon')).toHaveLength(5)
    expect(plan.noRoom.map((n) => n.file.name)).toEqual(['Relaxed Linen Shirt tryon6.jpg'])
    expect(plan.unmatched.map((f) => f.name)).toEqual(['random.jpg'])

    const lots = named(...Array.from({ length: 9 }, (_, i) => `Tie Back Dress ${i + 1}.jpg`))
    const full = planImportPhotos(lots, drafts)
    expect(full.matched.map((m) => m.angle)).toEqual(['front', 'back', 'detail', 'worn', 'extra', 'extra', 'extra', 'extra'])
    expect(full.noRoom).toHaveLength(1)
  })
})
