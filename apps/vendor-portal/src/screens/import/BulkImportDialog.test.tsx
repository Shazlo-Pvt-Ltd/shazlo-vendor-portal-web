import { configure, fireEvent, screen, waitFor, within } from '@testing-library/react'
import { Blob as NodeBlob, File as NodeFile, type BlobPart as NodeBlobPart } from 'node:buffer'
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { IMPORT_COLUMNS } from '../../lib/catalog'
import { renderApp } from '../../test/render'
import { planImportPhotos } from './photoPlan'

type User = Awaited<ReturnType<typeof renderApp>>['user']

// The first test also loads the Products and wizard chunks; give async queries room on slow machines.
configure({ asyncUtilTimeout: 8000, defaultHidden: true })

// jsdom's Blob, File and FormData cannot pass through Node's fetch (which MSW intercepts in tests):
// undici rejects them, its multipart parser builds files with the global File, and the mock checks
// `instanceof Blob`. These tests use Node's own classes instead.
beforeEach(async () => {
  const probe = await new Response('a=1', { headers: { 'Content-Type': 'application/x-www-form-urlencoded' } }).formData()
  vi.stubGlobal('FormData', probe.constructor)
  vi.stubGlobal('File', NodeFile)
  vi.stubGlobal('Blob', NodeBlob)
})
afterEach(() => {
  vi.unstubAllGlobals()
})

const file = (parts: (string | Uint8Array)[], name: string, type: string) => new NodeFile(parts as NodeBlobPart[], name, { type }) as unknown as File
const jpeg = (name: string) => file([new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0, 16])], name, 'image/jpeg')

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

const csv = (text: string, name = 'products.csv') => file([text], name, 'text/csv')

async function openWizard(options: { viewport?: 'desktop' | 'mobile' } = {}) {
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

// Saving a file goes through a Blob URL and a temporary download link.
function captureDownloads() {
  const blobs: Blob[] = []
  vi.spyOn(URL, 'createObjectURL').mockImplementation((blob) => {
    blobs.push(blob as Blob)
    return `blob:mock-${blobs.length}`
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

  it('opens the file picker from the keyboard', async () => {
    const { user, dialog } = await openWizard()
    await toUpload(user, dialog)
    const input = screen.getByLabelText('Spreadsheet file') as HTMLInputElement
    expect(input).toHaveAttribute('accept', '.xlsx,.xls,.csv')
    const pick = vi.spyOn(input, 'click').mockImplementation(() => {})
    within(dialog).getByRole('button', { name: 'choose a file' }).focus()
    await user.keyboard('{Enter}')
    expect(pick).toHaveBeenCalled()
  })

  it('checks a CSV row by row and says what to fix in plain words, with the column', async () => {
    const downloads = captureDownloads()
    const { user, dialog } = await openWizard()
    await toUpload(user, dialog)
    await upload(user, csv(MIXED_CSV))

    expect(await within(dialog).findByText('products.csv')).toBeInTheDocument()
    expect(within(dialog).getByText('6 rows')).toBeInTheDocument()
    expect(stat(dialog, 'Rows in file')).toHaveTextContent('6')
    expect(stat(dialog, 'Ready')).toHaveTextContent('3Will be saved as drafts')
    expect(stat(dialog, 'Need fixing')).toHaveTextContent('3Listed below')
    expect(within(dialog).queryByRole('group', { name: /Image/ })).toBeNull()

    const table = within(dialog).getByRole('table', { name: '3 rows need fixing' })
    expect(within(table).getAllByRole('columnheader').map((h) => h.textContent)).toEqual(['Row', 'Product', 'Column', 'What to fix'])
    const rows = within(table).getAllByRole('row').slice(1)
    expect(rows.map((r) => within(r).getAllByRole('cell').map((c) => c.textContent))).toEqual([
      ['5', 'Bagru Test Palazzo', 'Selling price', 'Must be a number above 0, like 1299. Found "1,299/-".'],
      ['6', '—', 'Product name', 'Required. Add a product name.'],
      ['7', 'Mashru Test Stole', 'Product type', '"Shawls & wraps" is not a product type we list. Closest match: Stoles.'],
      ['7', 'Mashru Test Stole', 'Sizes and stock', 'Could not read "M 6". Write each size and its stock, like S:4, M:6, L:3.'],
    ])
    expect(dialog).toHaveTextContent('3 products will be saved as drafts. Next, you can add their photos.')

    await user.click(within(dialog).getByRole('button', { name: 'Download what to fix' }))
    await waitFor(() => expect(downloads.blobs).toHaveLength(1))
    expect(downloads.names()).toEqual(['shazlo-import-fixes.csv'])
    const report = (await downloads.blobs[0]!.text()).replace(/^\uFEFF/, '').split('\r\n')
    expect(report[0]).toBe('Row,Product,Column,What to fix')
    expect(report[1]).toBe('5,Bagru Test Palazzo,Selling price,"Must be a number above 0, like 1299. Found ""1,299/-""."')
    expect(report[2]).toBe('6,,Product name,Required. Add a product name.')
  })

  it('saves the good rows as drafts, then matches photos to them by name and uploads them', async () => {
    const { user, dialog, db, router } = await openWizard()
    await toUpload(user, dialog)
    await upload(user, csv(MIXED_CSV))
    await user.click(await within(dialog).findByRole('button', { name: 'Save 3 drafts' }))

    expect(await within(dialog).findByText('3 drafts saved')).toBeInTheDocument()
    expect(within(dialog).getByText('Step 4 of 4: Add photos')).toBeInTheDocument()
    const shirt = db.products.find((p) => p.title === 'Relaxed Linen Shirt')!
    const kurta = db.products.find((p) => p.title === 'Indigo Test Kurta')!
    expect([shirt.status, kurta.status]).toEqual(['draft', 'draft'])
    expect(shirt).toMatchObject({ gender: 'Men', category: 'Shirts', main_colour: 'Beige', other_colours: ['White'], material: '100% linen', price_paise: 189900, mrp_paise: 249900 })
    expect(kurta.category).toBe('Kurtas')

    const input = within(dialog).getByLabelText('Photo files')
    expect(input).toHaveAttribute('multiple')
    expect(input).not.toHaveAttribute('capture')
    await user.upload(input, [
      jpeg('Relaxed Linen Shirt - front.jpg'),
      jpeg('Indigo Test Kurta.jpg'),
      jpeg('Relaxed Linen Shirt - back.jpg'),
      jpeg('Relaxed Linen Shirt_tryon2.jpg'),
      jpeg('IMG_2231.jpg'),
      file(['notes'], 'notes.txt', 'text/plain'),
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

    // The mock upload service reads photos with jsdom's FileReader, which refuses Node's Blob (used
    // here for the spreadsheet); without a FileReader it stands in a swatch for the photo.
    vi.stubGlobal('FileReader', undefined)
    // The first upload fails; it says why and can be tried again.
    db.failNext = { path: '/uploads/presign', status: 413, code: 'file_too_large', message: 'Photos can be up to 10 MB. Export a smaller copy and try again.' }
    await user.click(within(dialog).getByRole('button', { name: 'Add 4 photos' }))
    expect(await within(dialog).findByText('1 photo did not upload. Try them again, or add them later from each product.')).toBeInTheDocument()
    expect(within(matched).getAllByRole('listitem')[0]).toHaveTextContent('Photos can be up to 10 MB. Export a smaller copy and try again.')
    expect(within(dialog).getByText('3 of 4 photos added')).toBeInTheDocument()
    await user.click(within(dialog).getByRole('button', { name: 'Try again: Relaxed Linen Shirt - front.jpg' }))
    expect(await within(dialog).findByText('4 photos added. Check each draft, then send it for review from Products.')).toBeInTheDocument()

    const angles = (id: string) => db.products.find((p) => p.id === id)!.images.map((i) => i.angle).sort()
    expect(angles(shirt.id)).toEqual(['back', 'front', 'tryon'])
    expect(angles(kurta.id)).toEqual(['front'])

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
    await upload(user, csv(CLEAN_CSV, 'fixed.csv'))
    expect(await within(dialog).findByText('All 2 rows are ready')).toBeInTheDocument()
    await user.click(within(dialog).getByRole('button', { name: 'Save 2 drafts' }))
    await user.click(await within(dialog).findByRole('button', { name: 'Add photos later' }))
    await waitFor(() => expect(router.state.location.search).toBe('?status=draft'))
  })

  it('shows the example result for a spreadsheet, and lets the seller replace the file', async () => {
    const { user, dialog } = await openWizard()
    await toUpload(user, dialog)
    await upload(user, file(['PK'], 'kalki-products.xlsx', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'))

    expect(await within(dialog).findByText('kalki-products.xlsx')).toBeInTheDocument()
    expect(within(dialog).getByText('52 rows')).toBeInTheDocument()
    expect(stat(dialog, 'Rows in file')).toHaveTextContent('52')
    expect(stat(dialog, 'Ready')).toHaveTextContent('47')
    expect(stat(dialog, 'Need fixing')).toHaveTextContent('5')
    const table = within(dialog).getByRole('table', { name: '5 rows need fixing' })
    expect(within(table).getAllByRole('row')).toHaveLength(6)
    expect(within(dialog).getByRole('button', { name: 'Save 47 drafts' })).toBeEnabled()

    await user.click(within(dialog).getByRole('button', { name: 'Upload fixed file' }))
    expect(await within(dialog).findByText(/Drop your .xlsx or .csv here/)).toBeInTheDocument()
    await upload(user, csv(CLEAN_CSV, 'fixed.csv'))
    expect(await within(dialog).findByText('All 2 rows are ready')).toBeInTheDocument()
    expect(within(dialog).getByText('fixed.csv')).toBeInTheDocument()
    expect(within(dialog).queryByRole('table')).toBeNull()
    expect(within(dialog).queryByRole('button', { name: 'Upload fixed file' })).toBeNull()

    await user.click(within(dialog).getByRole('button', { name: 'Replace file' }))
    expect(await within(dialog).findByText(/Drop your .xlsx or .csv here/)).toBeInTheDocument()
  })

  it('refuses a file that is not a spreadsheet', async () => {
    const { user, dialog } = await openWizard()
    await toUpload(user, dialog)
    const zone = within(dialog).getByText(/Drop your .xlsx or .csv here/).closest('[data-dropzone]')!
    fireEvent.drop(zone, { dataTransfer: { files: [file(['%PDF'], 'lookbook.pdf', 'application/pdf')], types: ['Files'] } })
    expect(await within(dialog).findByRole('alert')).toHaveTextContent('Upload the template as .xlsx or .csv.')
    expect(within(dialog).getByText(/Drop your .xlsx or .csv here/)).toBeInTheDocument()

    // A good file afterwards clears the message.
    await upload(user, csv(CLEAN_CSV))
    expect(await within(dialog).findByText('All 2 rows are ready')).toBeInTheDocument()
    expect(within(dialog).queryByRole('alert')).toBeNull()
  })

  it('says when a file is too large', async () => {
    const { user, dialog, db } = await openWizard()
    await toUpload(user, dialog)
    db.failNext = { path: '/vendor/imports', status: 413, code: 'file_too_large', message: 'Files can be up to 10 MB. Split the sheet and upload it in parts.' }
    await upload(user, csv(CLEAN_CSV))
    expect(await within(dialog).findByRole('alert')).toHaveTextContent('Files can be up to 10 MB. Split the sheet and upload it in parts.')
  })

  it('fills the screen on phones and says a laptop is easier', async () => {
    const { dialog } = await openWizard({ viewport: 'mobile' })
    expect(dialog.className).toMatch(/FullScreen/)
    expect(within(dialog).getByText('Step 1 of 4: Download template')).toBeInTheDocument()
    expect(within(dialog).getByText('Easier on a laptop')).toBeInTheDocument()
    expect(dialog).toHaveTextContent('Spreadsheets are hard to fill in and fix on a phone.')
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
