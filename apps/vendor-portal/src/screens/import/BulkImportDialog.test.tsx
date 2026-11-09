import { configure, fireEvent, screen, waitFor, within } from '@testing-library/react'
import { Blob as NodeBlob, File as NodeFile } from 'node:buffer'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { renderApp } from '../../test/render'

type User = Awaited<ReturnType<typeof renderApp>>['user']

// The first test also loads the Products and wizard chunks; give async queries room on slow machines.
configure({ asyncUtilTimeout: 4000 })

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

const file = (parts: string[], name: string, type: string) => new NodeFile(parts, name, { type }) as unknown as File

const HEADER = 'product_id,product_name,category,description,price,mrp,stock_qty,size,gender,material,image_1,image_2,image_3,returnable'

// Three good rows; a bad price, a missing name, and a row with an unsupported size and an http image link.
const MIXED_CSV = [
  HEADER,
  'KS-T-001,Indigo Test Kurta,Kurtas,Hand block-printed,1499,1799,4,M,Women,Cotton (mul),https://img.example/1.jpg,,,yes',
  'KS-T-002,Rust Test Shirt,Shirts,,1299,1499,6,L,Unisex,Linen,https://img.example/2.jpg,,,yes',
  'KS-T-003,Ivory Test Kurti,Kurtis,,1199,1399,5,S,Women,Cotton,https://img.example/3.jpg,,,yes',
  'KS-T-004,Bagru Test Palazzo,Palazzos,,"1,299/-",1600,3,M,Women,Cotton,https://img.example/4.jpg,,,yes',
  'KS-T-005,,Kurtas,,999,999,2,S,Women,Cotton,https://img.example/5.jpg,,,yes',
  'KS-T-006,Mashru Test Stole,Stoles,,899,999,9,Free size,Women,Silk,http://img.example/6.jpg,,,yes',
].join('\n')

const CLEAN_CSV = [
  HEADER,
  'KS-C-001,Chanderi Clean Kurta,Kurtas,,2199,2499,4,M,Women,Chanderi,https://img.example/c1.jpg,,,yes',
  'KS-C-002,Khadi Clean Shirt,Shirts,,1599,1799,3,L,Men,Khadi,https://img.example/c2.jpg,,,yes',
].join('\n')

const csv = (text: string, name = 'catalogue.csv') => file([text], name, 'text/csv')

async function openWizard(options: { viewport?: 'desktop' | 'mobile' } = {}) {
  const app = await renderApp({ route: '/products/import', ...options })
  const dialog = await screen.findByRole('dialog', { name: 'Bulk import' })
  return { ...app, dialog }
}

async function toUpload(user: User, dialog: HTMLElement) {
  await user.click(within(dialog).getByRole('button', { name: 'I already have a file' }))
  return within(dialog).findByText(/Drop your .xlsx or .csv here/)
}

async function upload(user: User, file: File) {
  await user.upload(screen.getByLabelText('Spreadsheet file'), file)
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

const readBlob = (blob: Blob) => blob.text()

describe('V-08 Bulk import', () => {
  it('opens as a wizard over Products and closes back to the list', async () => {
    const { user, router, dialog } = await openWizard()
    expect(dialog).toHaveTextContent('Add many products at once from a spreadsheet. Imported products are created as drafts; nothing goes live until it is reviewed.')
    expect(screen.getByRole('heading', { level: 1, name: 'Products', hidden: true })).toBeInTheDocument()
    for (const step of ['Download template', 'Upload file', 'Fix errors', 'Create drafts']) {
      expect(within(dialog).getAllByText(step).length).toBeGreaterThan(0)
    }

    const guide = within(dialog).getByRole('list', { name: 'Template columns' })
    const columns = within(guide).getAllByRole('listitem').map((li) => li.textContent)
    expect(columns).toHaveLength(11)
    expect(columns[0]).toBe('Product IDRequired')
    expect(columns).toContain('Image 1–3 (links)1 required')
    expect(columns).toContain('ReturnableDefault: store policy')
    expect(dialog).toHaveTextContent('Sizes: One row per size. Rows with the same Product ID become one product with several sizes.')

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

  it('downloads the template as a CSV and moves on to the upload', async () => {
    const downloads = captureDownloads()
    const { user, dialog } = await openWizard()
    await user.click(within(dialog).getByRole('button', { name: 'Download template' }))
    await waitFor(() => expect(downloads.blobs).toHaveLength(1))
    expect(downloads.names()).toEqual(['shazlo-catalogue-template.csv'])
    expect(await readBlob(downloads.blobs[0]!)).toMatch(/^product_id,product_name,category,description,price,mrp/)
    expect(await screen.findByText('Template downloaded. Fill it in, then upload it here.')).toBeInTheDocument()
    expect(await within(dialog).findByText(/Drop your .xlsx or .csv here/)).toBeInTheDocument()
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

  it('checks a CSV row by row and lists what to fix', async () => {
    const downloads = captureDownloads()
    const { user, dialog } = await openWizard()
    await toUpload(user, dialog)
    await upload(user, csv(MIXED_CSV))

    expect(await within(dialog).findByText('catalogue.csv')).toBeInTheDocument()
    expect(within(dialog).getByText('6 rows')).toBeInTheDocument()
    expect(stat(dialog, 'Rows in file')).toHaveTextContent('6')
    expect(stat(dialog, 'Ready to import')).toHaveTextContent('3Will be created as drafts')
    expect(stat(dialog, 'Need fixing')).toHaveTextContent('3Listed below')
    expect(stat(dialog, 'Image links failed')).toHaveTextContent('1Product still created')

    const table = within(dialog).getByRole('table', { name: '3 rows need fixing' })
    expect(within(table).getAllByRole('columnheader').map((h) => h.textContent)).toEqual(['Row', 'Product', 'Column', 'What to fix'])
    const rows = within(table).getAllByRole('row').slice(1)
    expect(rows.map((r) => within(r).getAllByRole('cell').map((c) => c.textContent))).toEqual([
      ['5', 'Bagru Test Palazzo', 'Price', 'Must be a number above 0. Found "1,299/-"; use 1299.'],
      ['6', '—', 'Product name', 'Required. Add a product name.'],
      ['7', 'Mashru Test Stole', 'Size', '"Free size" is not supported. Use XS–XXL or One size.'],
      ['7', 'Mashru Test Stole', 'Image 1', 'Link could not be opened. Use a public https link, or add the photo in the editor.'],
    ])
    expect(dialog).toHaveTextContent('3 products will be created as drafts. You can check them and submit for review from Products.')

    await user.click(within(dialog).getByRole('button', { name: 'Download error report' }))
    await waitFor(() => expect(downloads.blobs).toHaveLength(1))
    expect(downloads.names()).toEqual(['shazlo-import-errors.csv'])
    const report = (await readBlob(downloads.blobs[0]!)).replace(/^\uFEFF/, '').split('\r\n')
    expect(report[0]).toBe('Row,Product,Column,What to fix')
    expect(report[1]).toBe('5,Bagru Test Palazzo,Price,"Must be a number above 0. Found ""1,299/-""; use 1299."')
    expect(report[2]).toBe('6,,Product name,Required. Add a product name.')
  })

  it('creates the good rows as drafts and shows them in Products', async () => {
    const { user, dialog, db, router } = await openWizard()
    await toUpload(user, dialog)
    await upload(user, csv(MIXED_CSV))
    await user.click(await within(dialog).findByRole('button', { name: 'Create 3 drafts' }))

    expect(await within(dialog).findByRole('heading', { name: '3 drafts created' })).toBeInTheDocument()
    const created = db.products.filter((p) => p.sku.startsWith('KS-T-'))
    expect(created.map((p) => [p.title, p.status])).toEqual(
      expect.arrayContaining([
        ['Indigo Test Kurta', 'draft'],
        ['Rust Test Shirt', 'draft'],
        ['Ivory Test Kurti', 'draft'],
      ]),
    )
    expect(created).toHaveLength(3)

    await user.click(within(dialog).getByRole('button', { name: 'View drafts' }))
    await waitFor(() => expect(router.state.location.pathname).toBe('/products'))
    expect(router.state.location.search).toBe('?status=draft')
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
    expect(await screen.findByRole('tab', { name: 'Drafts 6' })).toHaveAttribute('aria-selected', 'true')
    expect(await screen.findByRole('link', { name: 'Ivory Test Kurti' })).toBeInTheDocument()
  })

  it('shows the example result for a spreadsheet, and lets the seller replace the file', async () => {
    const { user, dialog } = await openWizard()
    await toUpload(user, dialog)
    await upload(user, file(['PK'], 'kalki-catalogue.xlsx', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'))

    expect(await within(dialog).findByText('kalki-catalogue.xlsx')).toBeInTheDocument()
    expect(within(dialog).getByText('52 rows')).toBeInTheDocument()
    expect(stat(dialog, 'Rows in file')).toHaveTextContent('52')
    expect(stat(dialog, 'Ready to import')).toHaveTextContent('47')
    expect(stat(dialog, 'Need fixing')).toHaveTextContent('5')
    expect(stat(dialog, 'Image links failed')).toHaveTextContent('3')
    const table = within(dialog).getByRole('table', { name: '5 rows need fixing' })
    expect(within(table).getAllByRole('row')).toHaveLength(6)
    expect(within(dialog).getByRole('button', { name: 'Create 47 drafts' })).toBeEnabled()
    expect(dialog).toHaveTextContent('47 products will be created as drafts.')

    await user.click(within(dialog).getByRole('button', { name: 'Upload fixed file' }))
    expect(await within(dialog).findByText(/Drop your .xlsx or .csv here/)).toBeInTheDocument()
    await upload(user, csv(CLEAN_CSV, 'fixed.csv'))
    expect(await within(dialog).findByText('All 2 rows are ready')).toBeInTheDocument()
    expect(within(dialog).getByText('fixed.csv')).toBeInTheDocument()
    expect(within(dialog).queryByRole('table')).toBeNull()
    expect(within(dialog).queryByRole('button', { name: 'Upload fixed file' })).toBeNull()
    expect(within(dialog).getByRole('button', { name: 'Create 2 drafts' })).toBeInTheDocument()

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

  it('fills the screen on phones', async () => {
    const { dialog } = await openWizard({ viewport: 'mobile' })
    expect(dialog.className).toMatch(/FullScreen/)
    expect(within(dialog).getByText('Step 1 of 4: Download template')).toBeInTheDocument()
  })
})
