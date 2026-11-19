import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { delay, http, HttpResponse } from 'msw'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { ImportReport } from '../../api'
import { makeStore, sessionBody } from '../../session/testing'
import { BASE, apiErrorResponse, useApiServer } from '../../test/msw'
import { renderRoute } from '../../test/renderRoute'
import { setViewport } from '../../test/viewport'
import { report } from './testing'

const server = useApiServer()
const IMPORT = `${BASE}/v1/vendor/products/import`

const csv = (name = 'products.csv', text = 'sku,title\nK1,Kurta') => new File([text], name, { type: 'text/csv' })

const cleanCheck = report({
  summary: { products: 2, valid: 2, rows_read: 3 },
  products: [
    { sku: 'KURTA-001', rows: [2, 3], status: 'valid', product_id: null },
    { sku: 'SCARF-014', rows: [4], status: 'valid', product_id: null },
  ],
})

const rowErrors = Array.from({ length: 30 }, (_, i) => ({
  row: i + 2,
  column: i % 3 === 0 ? 'price' : i % 3 === 1 ? 'gender' : null,
  code: 'bad',
  message: i % 3 === 0 ? `Price on row ${i + 2} is not an amount` : i % 3 === 1 ? 'Use women, men or unisex' : 'This size and colour appear twice',
}))

const checkWithErrors = report({
  summary: { products: 12, valid: 2, rejected: 10, rows_read: 32, rows_with_errors: 30 },
  errors: rowErrors,
  ignored_columns: ['colour'],
})

const imported = (mode = 'import') =>
  report({
    mode,
    committed: true,
    summary: { products: 2, created: 1, unchanged: 1, rows_read: 3 },
    products: [
      { sku: 'KURTA-001', rows: [2, 3], status: 'created', product_id: 'p-new' },
      { sku: 'SCARF-014', rows: [4], status: 'unchanged', product_id: 'p-old' },
    ],
  })

/** A fake import endpoint: answers by mode and records each call's mode and body. */
function serve(answers: Partial<Record<string, () => Response | Promise<Response>>>) {
  const calls: { mode: string | null; type: string | null; body: string }[] = []
  server.use(
    http.post(IMPORT, async ({ request }) => {
      const mode = new URL(request.url).searchParams.get('mode')
      calls.push({ mode, type: request.headers.get('Content-Type'), body: await request.text() })
      const answer = answers[mode ?? '']
      return answer ? answer() : apiErrorResponse(500, 'unexpected')
    }),
  )
  return calls
}

const json = (body: ImportReport) => () => HttpResponse.json(body)

async function open() {
  setViewport(1280)
  renderRoute('/import', { store: makeStore({ refresh: async () => sessionBody() }).store })
  await screen.findByRole('heading', { level: 1, name: 'Bulk import' }, { timeout: 15_000 })
  return userEvent.setup()
}

const fileInput = () => screen.getByLabelText('Spreadsheet to import') as HTMLInputElement

let saved: { blob: Blob; name: string }[] = []
beforeEach(() => {
  saved = []
  // jsdom has no object URLs and does not download: record what the page hands the browser.
  vi.stubGlobal('URL', Object.assign(URL, { createObjectURL: vi.fn(() => 'blob:test'), revokeObjectURL: vi.fn() }))
  vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (this: HTMLAnchorElement) {
    const blob = (URL.createObjectURL as ReturnType<typeof vi.fn>).mock.calls.at(-1)?.[0] as Blob
    saved.push({ blob, name: this.download })
  })
})
afterEach(() => {
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

describe('the bulk import', () => {
  it('does not offer the import before the file is checked', async () => {
    const user = await open()
    expect(screen.getByText('Check your file first. The import is offered once the check is done.')).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'Import' })).toBeNull()
    await user.upload(fileInput(), csv())
    expect(screen.queryByRole('button', { name: 'Import' })).toBeNull()
  })

  it('checks a clean file without writing, then imports it after a confirmation', async () => {
    const calls = serve({ validate: json(cleanCheck), import: json(imported()) })
    const user = await open()
    await user.upload(fileInput(), csv())
    expect(screen.getByText('products.csv')).toBeTruthy()
    await user.click(screen.getByRole('button', { name: 'Check the file' }))

    expect(await screen.findByRole('heading', { name: 'The file is ready to import' })).toBeTruthy()
    expect(calls).toEqual([{ mode: 'validate', type: 'text/csv', body: 'sku,title\nK1,Kurta' }])
    await waitFor(() => expect(document.activeElement).toBe(screen.getByRole('heading', { name: 'The file is ready to import' })))

    await user.click(screen.getByRole('button', { name: 'Import' }))
    const dialog = await screen.findByRole('dialog')
    expect(within(dialog).getByText('2 new products will be created as drafts.')).toBeTruthy()
    await user.click(within(dialog).getByRole('button', { name: 'Import' }))

    expect(await screen.findByRole('heading', { name: 'Import finished' })).toBeTruthy()
    expect(calls.map((c) => c.mode)).toEqual(['validate', 'import'])
    expect(screen.getByText('1 product imported')).toBeTruthy()
    expect(screen.getByRole('link', { name: 'KURTA-001' }).getAttribute('href')).toBe('/products/p-new')
    expect(screen.queryByRole('link', { name: 'SCARF-014' })).toBeNull()
    expect(screen.getByText(/Importing this file again is safe/)).toBeTruthy()
  })

  it('writes nothing when the confirmation is declined', async () => {
    const calls = serve({ validate: json(cleanCheck), import: json(imported()) })
    const user = await open()
    await user.upload(fileInput(), csv())
    await user.click(screen.getByRole('button', { name: 'Check the file' }))
    await user.click(await screen.findByRole('button', { name: 'Import' }))
    await user.click(within(await screen.findByRole('dialog')).getByRole('button', { name: 'Cancel' }))
    expect(calls.map((c) => c.mode)).toEqual(['validate'])
  })

  it('says so, without asking for fixes, when every product was already imported', async () => {
    serve({
      validate: json(report({ summary: { products: 2, unchanged: 2, rows_read: 2 } })),
      import: json(report({ mode: 'import', committed: false, summary: { products: 2, unchanged: 2, rows_read: 2 } })),
    })
    const user = await open()
    await user.upload(fileInput(), csv())
    await user.click(screen.getByRole('button', { name: 'Check the file' }))
    await user.click(await screen.findByRole('button', { name: 'Import' }))
    await user.click(within(await screen.findByRole('dialog')).getByRole('button', { name: 'Import' }))
    expect(await screen.findByRole('heading', { name: 'Already imported' })).toBeTruthy()
    expect(screen.getByText(/already in your products list, so nothing changed/)).toBeTruthy()
    expect(screen.queryByText(/Fix the problems/)).toBeNull()
  })

  it('sends all_or_nothing when chosen, and says when nothing was written', async () => {
    const calls = serve({
      validate: json(checkWithErrors),
      all_or_nothing: json(report({ mode: 'all_or_nothing', committed: false, summary: { rejected: 10, valid: 2 }, errors: rowErrors })),
    })
    const user = await open()
    await user.upload(fileInput(), csv())
    await user.click(screen.getByRole('button', { name: 'Check the file' }))
    await user.click(await screen.findByRole('radio', { name: /All or nothing/ }))
    await user.click(screen.getByRole('button', { name: 'Import' }))
    const dialog = await screen.findByRole('dialog')
    expect(within(dialog).getByText(/If any row has a problem, nothing is written/)).toBeTruthy()
    await user.click(within(dialog).getByRole('button', { name: 'Import' }))
    expect(await screen.findByRole('heading', { name: 'Nothing was imported' })).toBeTruthy()
    expect(calls.map((c) => c.mode)).toEqual(['validate', 'all_or_nothing'])
  })

  it('lists the problems, filters and searches them, and downloads them as CSV', async () => {
    serve({ validate: json(checkWithErrors) })
    const user = await open()
    await user.upload(fileInput(), csv('Spring catalog.xlsx'))
    await user.click(screen.getByRole('button', { name: 'Check the file' }))

    expect(await screen.findByRole('heading', { name: 'Some rows need changes' })).toBeTruthy()
    expect(screen.getByText(/30 rows have problems/)).toBeTruthy()
    expect(screen.getByText(/were ignored: colour/)).toBeTruthy()
    const table = screen.getByRole('table', { name: /Problems to fix \(30\)/ })
    // 25 a page, plus the header row.
    expect(within(table).getAllByRole('row')).toHaveLength(26)

    await user.click(screen.getByRole('combobox', { name: 'Column' }))
    await user.click(await screen.findByRole('option', { name: 'price' }))
    expect(screen.getByText('10 of 30 problems match.')).toBeTruthy()
    await user.type(screen.getByRole('searchbox', { name: 'Search the problems' }), 'row 5')
    expect(screen.getByText('1 of 30 problems match.')).toBeTruthy()
    expect(within(table).getByText('Price on row 5 is not an amount')).toBeTruthy()

    // The download holds every problem, not only the ones on screen.
    await user.click(screen.getByRole('button', { name: 'Download the error report (CSV)' }))
    expect(saved).toHaveLength(1)
    expect(saved[0]!.name).toBe('Spring-catalog-errors.csv')
    const text = await saved[0]!.blob.text()
    expect(text.split('\r\n').filter(Boolean)).toHaveLength(31)
    expect(text).toContain('2,price,bad,Price on row 2 is not an amount')
  })

  it('says when the list of problems is cut short', async () => {
    serve({ validate: json(report({ ...checkWithErrors, summary: checkWithErrors.summary, errors_truncated: true })) })
    const user = await open()
    await user.upload(fileInput(), csv())
    await user.click(screen.getByRole('button', { name: 'Check the file' }))
    expect(await screen.findByText(/There are more problems than we can list. Here are the first 30./)).toBeTruthy()
  })

  it('offers nothing to import when every product has problems', async () => {
    serve({ validate: json(report({ summary: { rejected: 2, rows_with_errors: 2 }, errors: rowErrors.slice(0, 2) })) })
    const user = await open()
    await user.upload(fileInput(), csv())
    await user.click(screen.getByRole('button', { name: 'Check the file' }))
    expect(await screen.findByText(/There is nothing to import from this file yet/)).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'Import' })).toBeNull()
  })

  it('needs a new check after another file is chosen', async () => {
    serve({ validate: json(cleanCheck) })
    const user = await open()
    await user.upload(fileInput(), csv())
    await user.click(screen.getByRole('button', { name: 'Check the file' }))
    await screen.findByRole('button', { name: 'Import' })
    await user.upload(fileInput(), csv('other.csv'))
    expect(screen.queryByRole('button', { name: 'Import' })).toBeNull()
    expect(screen.getByText('Check your file first. The import is offered once the check is done.')).toBeTruthy()
  })

  it('refuses another type or a file over the limit without sending it', async () => {
    const calls = serve({ validate: json(cleanCheck) })
    const user = userEvent.setup({ applyAccept: false })
    setViewport(1280)
    renderRoute('/import', { store: makeStore({ refresh: async () => sessionBody() }).store })
    await screen.findByRole('heading', { level: 1, name: 'Bulk import' }, { timeout: 15_000 })

    await user.upload(fileInput(), new File(['x'], 'notes.txt', { type: 'text/plain' }))
    expect(screen.getByRole('alert').textContent).toMatch(/Choose a CSV \(\.csv\) or Excel \(\.xlsx\) file/)
    const big = csv()
    Object.defineProperty(big, 'size', { value: 3 * 1024 * 1024 })
    await user.upload(fileInput(), big)
    expect(screen.getByRole('alert').textContent).toMatch(/This file is 3 MB; the limit is 2 MB/)
    expect(isDisabled(screen.getByRole('button', { name: 'Check the file' }))).toBe(true)
    expect(calls).toEqual([])
  })

  it.each([
    [413, 'file_too_large', /This file is too large; the limit is 2 MB/],
    [415, 'unsupported_file_type', /This is not a CSV or Excel file/],
    [422, 'invalid_file', /We could not read this file. The file is missing the columns: price\. Compare it with the template\./],
  ])('explains a %i from the server', async (status, code, message) => {
    serve({ validate: () => apiErrorResponse(status, code, 'The file is missing the columns: price') })
    const user = await open()
    await user.upload(fileInput(), csv())
    await user.click(screen.getByRole('button', { name: 'Check the file' }))
    expect((await screen.findByRole('alert')).textContent).toMatch(message)
  })

  it('shows progress while checking, and can cancel', async () => {
    serve({
      validate: async () => {
        await delay('infinite')
        return HttpResponse.json(cleanCheck)
      },
    })
    const user = await open()
    await user.upload(fileInput(), csv())
    await user.click(screen.getByRole('button', { name: 'Check the file' }))
    expect(await screen.findByRole('progressbar', { name: 'Checking the file' })).toBeTruthy()
    await user.click(screen.getByRole('button', { name: 'Cancel the check' }))
    expect((await screen.findByRole('alert')).textContent).toBe('The check was cancelled. Nothing was imported.')
    expect(screen.queryByRole('progressbar')).toBeNull()
  })

  it('downloads the template', async () => {
    let format: string | null = null
    server.use(
      http.get(`${IMPORT}/template`, ({ request }) => {
        format = new URL(request.url).searchParams.get('format')
        return new HttpResponse('sku,title\n', { headers: { 'Content-Type': 'text/csv' } })
      }),
    )
    const user = await open()
    await user.click(screen.getByRole('button', { name: 'Download the template (CSV)' }))
    await waitFor(() => expect(saved).toHaveLength(1))
    expect(format).toBe('csv')
    expect(saved[0]!.name).toBe('shazlo-product-import-template.csv')
  })
})

const isDisabled = (element: Element) => element.matches(':disabled')
