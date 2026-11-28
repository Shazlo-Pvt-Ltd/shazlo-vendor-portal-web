import { screen, waitFor, within } from '@testing-library/react'
import { http, HttpResponse } from 'msw'
import { describe, expect, it } from 'vitest'
import { renderModule } from '../../test/render'
import { server } from '../../test/server'
import { setViewport } from '../../test/viewport'

// A-09 Products tab: tick several of a brand's waiting products, or all of them, and approve them
// together, each with the version the reviewer saw. Kalki Studio has four waiting: Ajrakh (₹2,499),
// Dabu skirt (₹1,450), the handloom shirt (₹1,199, an edit to a live product) and Pochampally (₹2,299).

type View = ReturnType<typeof renderModule>
type Db = View['db']

const AJRAKH = 'Ajrakh Block-Print Kurta'
const DABU = 'Dabu Print Wrap Skirt'
const SHIRT = 'Handloom Cotton Shirt — Rust'
const POCHAMPALLY = 'Pochampally Ikat Kurta'
const ROUTE = '*/api/v1/admin/vendors/:id/products/approve'

async function openProducts(id: string, name: string, before?: (db: Db) => void) {
  const view = renderModule({ route: `/vendors/${id}?tab=products` })
  before?.(view.db)
  // The first screen in a file compiles on demand; give it room on a busy machine.
  await screen.findByRole('heading', { level: 1, name }, { timeout: 10_000 })
  return view
}

const list = () => screen.getByRole('list', { name: 'Products from this vendor' })
// `hidden` reaches the page behind an open dialog, which MUI hides from the accessibility tree.
const toolbar = (hidden = false) => screen.getByRole('group', { name: 'Approve waiting products', hidden })
const tickFor = (title: string, hidden = false) => screen.getByRole('checkbox', { name: `Select ${title}`, hidden })
const product = (db: Db, id: string) => db.products.find((p) => p.id === id)!

// Every body sent to the bulk route; the mock still answers.
function spyOnApprove() {
  const bodies: unknown[] = []
  server.use(
    http.post(ROUTE, async ({ request }) => {
      bodies.push(await request.clone().json())
    }),
  )
  return bodies
}

// jsdom answers CSS media queries as a 1024 px window, so getComputedStyle gives the desktop sizes
// (MUI writes even `xs` values inside `@media (min-width:0px)`). This reads a property as a
// `width` px frame would: the last declaration, in sheet order, of the rules that match the element,
// at the top level or inside @media rules made only of min/max-width clauses that hold at `width`.
const WIDTH_CLAUSE = /\((min|max)-width:\s*([\d.]+)px\)/g
function holdsAt(media: string, width: number) {
  const clauses = [...media.matchAll(WIDTH_CLAUSE)]
  const onlyWidths = media.replace(WIDTH_CLAUSE, '').replace(/\band\b/g, '').trim() === ''
  return clauses.length > 0 && onlyWidths && clauses.every(([, kind, px]) => (kind === 'min' ? width >= Number(px) : width <= Number(px)))
}
function styleAt(width: number, el: Element, property: string) {
  let value = ''
  const visit = (rules: CSSRuleList) => {
    for (const rule of Array.from(rules)) {
      if (rule instanceof CSSMediaRule) {
        if (holdsAt(rule.media.mediaText, width)) visit(rule.cssRules)
      } else if (rule instanceof CSSStyleRule) {
        let matches = false
        try {
          matches = el.matches(rule.selectorText)
        } catch {
          // A pseudo-element selector: never the element itself.
        }
        if (matches) value = rule.style.getPropertyValue(property) || value
      }
    }
  }
  for (const sheet of Array.from(document.styleSheets)) visit(sheet.cssRules)
  return value
}
const phoneStyle = (el: Element, property: string) => styleAt(390, el, property)

async function openDialog(user: View['user'], k: number, brand = 'Kalki Studio') {
  await user.click(within(toolbar()).getByRole('button', { name: `Approve ${k} ${k === 1 ? 'product' : 'products'}` }))
  return screen.findByRole('dialog', { name: `Approve ${k} ${k === 1 ? 'product' : 'products'} from ${brand}?` })
}

describe('A-09 Approving several products at once', { timeout: 40_000 }, () => {
  it('shows no ticks and no toolbar when nothing waits', async () => {
    await openProducts('v_kalki', 'Kalki Studio', (db) => {
      for (const p of db.products) if (p.vendorId === 'v_kalki') p.status = 'approved'
    })
    expect(within(list()).getAllByRole('listitem')).toHaveLength(4)
    expect(screen.queryByRole('group', { name: 'Approve waiting products' })).not.toBeInTheDocument()
    expect(within(list()).queryAllByRole('checkbox')).toHaveLength(0)
    expect(screen.queryByRole('button', { name: /^Approve/ })).not.toBeInTheDocument()
  })

  it('has no toolbar for a brand without products', async () => {
    await openProducts('v_morpankh', 'Mor Pankh Clothing')
    expect(await screen.findByRole('heading', { name: 'No products yet' })).toBeInTheDocument()
    expect(screen.queryByRole('group', { name: 'Approve waiting products' })).not.toBeInTheDocument()
  })

  // Approving together publishes; a suspended brand's products are hidden from the app, so each
  // waiting one is reviewed on its own page.
  it('has no ticks for a suspended brand, whose waiting products still open', async () => {
    await openProducts('v_kalki', 'Kalki Studio', (db) => {
      db.vendors.find((v) => v.id === 'v_kalki')!.status = 'suspended'
    })
    expect(screen.queryByRole('group', { name: 'Approve waiting products' })).not.toBeInTheDocument()
    expect(within(list()).queryAllByRole('checkbox')).toHaveLength(0)
    // Each opens its review, by the review's id, once the queue has said which review that is.
    await waitFor(() => expect(within(list()).getAllByRole('link')).toHaveLength(4))
    expect(within(list()).getByRole('link', { name: new RegExp(AJRAKH) })).toHaveAttribute('href', '/review/product/rev_p_ajrakh')
  })

  it('ticks two of Kalki Studio’s four and approves them, each as its own decision', async () => {
    const { user, db, shell } = await openProducts('v_kalki', 'Kalki Studio')
    const bodies = spyOnApprove()
    const all = within(toolbar()).getByRole('checkbox', { name: 'Select all 4 waiting products' })
    expect(all).not.toBeChecked()
    expect(within(toolbar()).getByText('0 selected')).toBeInTheDocument()
    expect(within(toolbar()).getByRole('button', { name: 'Approve selected' })).toBeDisabled()

    // A tick per waiting product, beside its link and never inside it; the rest of the row opens it.
    await waitFor(() => expect(within(list()).getAllByRole('link')).toHaveLength(4))
    for (const title of [AJRAKH, DABU, SHIRT, POCHAMPALLY]) {
      const box = tickFor(title)
      expect(box.closest('a')).toBeNull()
      expect(box.closest('li')!.querySelector('a')).toHaveAttribute('href', expect.stringMatching(/^\/review\/product\//))
    }
    expect(within(list()).getByRole('link', { name: new RegExp(AJRAKH) })).toHaveAttribute('href', '/review/product/rev_p_ajrakh')

    await user.click(tickFor(AJRAKH))
    await user.click(tickFor(POCHAMPALLY))
    expect(all).toBePartiallyChecked()
    expect(within(toolbar()).getByText('2 selected')).toBeInTheDocument()

    const events = db.outbox.length
    const decisions = db.decisions.length
    const dialog = await openDialog(user, 2)
    expect(within(dialog).getByText('They will be published to the Shazlo app. To check any of them first, cancel and open it from the list.')).toBeInTheDocument()
    const items = within(within(dialog).getByRole('list', { name: 'Products to approve' })).getAllByRole('listitem')
    expect(items.map((li) => li.textContent)).toEqual([`${AJRAKH}₹2,499`, `${POCHAMPALLY}₹2,299`])
    await user.click(within(dialog).getByRole('button', { name: 'Approve 2 products' }))

    expect(await screen.findByText('Approved 2 products from Kalki Studio. They are being published to the Shazlo app.')).toBeInTheDocument()
    expect(shell.toasts()).toContainEqual({ level: 'success', message: 'Approved 2 products from Kalki Studio' })
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())

    // Sent with the version the reviewer saw.
    expect(bodies).toEqual([{ products: [{ id: 'p_ajrakh', submitted_at: product(db, 'p_ajrakh').submittedAt }, { id: 'p_pochampally', submitted_at: product(db, 'p_pochampally').submittedAt }] }])
    for (const id of ['p_ajrakh', 'p_pochampally']) {
      expect(product(db, id).status).toBe('approved')
      expect(product(db, id).history[0]).toMatchObject({ event: 'approved', by: 'Priya Mehta' })
    }
    expect(product(db, 'p_dabu_skirt').status).toBe('pending_review')
    expect(product(db, 'p_handloom').status).toBe('pending_review')
    // One decision and one publishing event each, as when approving one at a time.
    expect(db.decisions).toHaveLength(decisions + 2)
    expect(db.decisions.slice(0, 2).map((d) => [d.subjectId, d.decision, d.reviewer])).toEqual([
      ['p_pochampally', 'approved', 'Priya Mehta'],
      ['p_ajrakh', 'approved', 'Priya Mehta'],
    ])
    expect(db.outbox).toHaveLength(events + 2)
    expect(db.outbox.slice(0, 2).map((e) => [e.event, e.subject])).toEqual([
      ['product.published', POCHAMPALLY],
      ['product.published', AJRAKH],
    ])

    // The two approved are live and drop out; the other two still wait and can be ticked.
    await waitFor(() => expect(screen.queryByRole('checkbox', { name: `Select ${AJRAKH}` })).not.toBeInTheDocument())
    expect(within(tickFor(DABU).closest('li')!).getByText('Pending review')).toBeInTheDocument()
    expect(within(screen.getByText(AJRAKH).closest('li')!).getByText('Live')).toBeInTheDocument()
    expect(within(toolbar()).getByRole('checkbox', { name: 'Select all 2 waiting products' })).not.toBeChecked()
    expect(within(toolbar()).getByText('0 selected')).toBeInTheDocument()
    expect(tickFor(DABU)).not.toBeChecked()
    expect(tickFor(SHIRT)).not.toBeChecked()
    await user.click(tickFor(SHIRT))
    expect(within(toolbar()).getByRole('button', { name: 'Approve 1 product' })).toBeEnabled()
  })

  it('selects all waiting and approves all four', async () => {
    const { user, db } = await openProducts('v_kalki', 'Kalki Studio')
    const live = db.vendors.find((v) => v.id === 'v_kalki')!.live_products
    const all = within(toolbar()).getByRole('checkbox', { name: 'Select all 4 waiting products' })
    await user.click(all)
    expect(all).toBeChecked()
    for (const title of [AJRAKH, DABU, SHIRT, POCHAMPALLY]) expect(tickFor(title)).toBeChecked()
    expect(within(toolbar()).getByText('4 selected')).toBeInTheDocument()

    // Unticking one leaves "select all" partly ticked; ticking it again selects all.
    await user.click(tickFor(DABU))
    expect(all).toBePartiallyChecked()
    await user.click(all)
    expect(all).toBeChecked()

    const dialog = await openDialog(user, 4)
    expect(within(dialog).getAllByRole('listitem')).toHaveLength(4)
    await user.click(within(dialog).getByRole('button', { name: 'Approve 4 products' }))
    expect(await screen.findByText('Approved 4 products from Kalki Studio. They are being published to the Shazlo app.')).toBeInTheDocument()
    for (const id of ['p_ajrakh', 'p_dabu_skirt', 'p_handloom', 'p_pochampally']) expect(product(db, id).status).toBe('approved')
    // An edit to a live product updates it; the three new ones are published.
    expect(db.outbox.slice(0, 4).map((e) => e.event).sort()).toEqual(['product.published', 'product.published', 'product.published', 'product.updated'])
    expect(db.vendors.find((v) => v.id === 'v_kalki')!.live_products).toBe(live + 3)

    // Nothing waits now: the toolbar and the ticks go, and keyboard focus stays in the list.
    await waitFor(() => expect(screen.queryByRole('dialog', { hidden: true })).not.toBeInTheDocument())
    await waitFor(() => expect(screen.queryByRole('group', { name: 'Approve waiting products', hidden: true })).not.toBeInTheDocument())
    expect(within(list()).queryAllByRole('checkbox')).toHaveLength(0)
    expect(within(list()).queryAllByRole('link')).toHaveLength(0)
    await waitFor(() => expect(list()).toHaveFocus())
  })

  it('says one product in the singular', async () => {
    const { user, db, shell } = await openProducts('v_nila', 'Nila Handloom')
    const all = within(toolbar()).getByRole('checkbox', { name: 'Select the 1 waiting product' })
    await user.click(all)
    expect(within(toolbar()).getByText('1 selected')).toBeInTheDocument()
    const dialog = await openDialog(user, 1, 'Nila Handloom')
    expect(within(dialog).getByText('It will be published to the Shazlo app. To check it first, cancel and open it from the list.')).toBeInTheDocument()
    await user.click(within(dialog).getByRole('button', { name: 'Approve 1 product' }))
    expect(await screen.findByText('Approved 1 product from Nila Handloom. It is being published to the Shazlo app.')).toBeInTheDocument()
    expect(shell.toasts()).toContainEqual({ level: 'success', message: 'Approved 1 product from Nila Handloom' })
    expect(product(db, 'p_phulkari').status).toBe('approved')
  })

  it('says which products lack required photos before approving them', async () => {
    // Indigo Loom's kurta set has 2 of the 5 try-on photos the review page asks for.
    const { user, db } = await openProducts('v_indigo', 'Indigo Loom')
    await user.click(tickFor('Indigo Dabu Kurta Set'))
    const dialog = await openDialog(user, 1, 'Indigo Loom')
    const [item] = within(within(dialog).getByRole('list', { name: 'Products to approve' })).getAllByRole('listitem')
    expect(item).toHaveTextContent('Indigo Dabu Kurta SetMissing 3 required photos₹2,899')
    // It is a warning, not a block: the reviewer may still approve it.
    await user.click(within(dialog).getByRole('button', { name: 'Approve 1 product' }))
    expect(await screen.findByText('Approved 1 product from Indigo Loom. It is being published to the Shazlo app.')).toBeInTheDocument()
    expect(product(db, 'p_dabu_set').status).toBe('approved')
  })

  it('holds the dialog while the approval is on its way', async () => {
    const { user, db } = await openProducts('v_kalki', 'Kalki Studio')
    let release = () => {}
    const held = new Promise<void>((resolve) => {
      release = resolve
    })
    // Waits to be released, then lets the mock answer.
    server.use(
      http.post(ROUTE, async () => {
        await held
      }),
    )
    await user.click(tickFor(AJRAKH))
    await user.click(tickFor(DABU))
    const dialog = await openDialog(user, 2)
    await user.click(within(dialog).getByRole('button', { name: 'Approve 2 products' }))

    expect(await within(dialog).findByRole('button', { name: 'Approving…' })).toBeDisabled()
    expect(within(dialog).getByRole('button', { name: 'Cancel' })).toBeDisabled()
    // Neither Escape nor a click beside the dialog closes it, so its answer is not lost.
    dialog.querySelector<HTMLElement>('.MuiDialogContent-root')!.focus()
    await user.keyboard('{Escape}')
    await user.click(document.querySelector('.MuiDialog-container')!)
    // A closing dialog is gone in about 200 ms (MUI's fade); this one is still there after 500.
    await expect(waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument(), { timeout: 500 })).rejects.toThrow()
    expect(screen.getByRole('dialog', { name: 'Approve 2 products from Kalki Studio?' })).toBeInTheDocument()
    expect(product(db, 'p_ajrakh').status).toBe('pending_review')

    release()
    expect(await screen.findByText('Approved 2 products from Kalki Studio. They are being published to the Shazlo app.')).toBeInTheDocument()
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
    expect(product(db, 'p_ajrakh').status).toBe('approved')
    expect(product(db, 'p_dabu_skirt').status).toBe('approved')
  })

  it('approves the others when one was already decided, and says which and why', async () => {
    const { user, db, shell } = await openProducts('v_kalki', 'Kalki Studio')
    for (const title of [AJRAKH, DABU, POCHAMPALLY]) await user.click(tickFor(title))
    const dialog = await openDialog(user, 3)
    // Someone else approves the skirt while the dialog is open.
    product(db, 'p_dabu_skirt').status = 'approved'
    const decisions = db.decisions.length
    await user.click(within(dialog).getByRole('button', { name: 'Approve 3 products' }))

    const alert = await screen.findByRole('alert')
    expect(within(alert).getByText('Approved 2 of 3 products from Kalki Studio.')).toBeInTheDocument()
    expect(within(alert).getByText('Not approved:')).toBeInTheDocument()
    const [item] = within(alert).getAllByRole('listitem')
    expect(item).toHaveTextContent(`${DABU}: Someone already decided it.`)
    expect(within(item!).getByRole('link', { name: DABU })).toHaveAttribute('href', '/review/product/rev_p_dabu_skirt')
    expect(shell.toasts()).toContainEqual({ level: 'warning', message: 'Approved 2 of 3 products from Kalki Studio' })
    expect(product(db, 'p_ajrakh').status).toBe('approved')
    expect(product(db, 'p_pochampally').status).toBe('approved')
    expect(db.decisions).toHaveLength(decisions + 2)
    expect(db.decisions.some((d, i) => i < 2 && d.subjectId === 'p_dabu_skirt')).toBe(false)
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
  })

  it('does not approve a product that changed since the reviewer looked', async () => {
    const { user, db } = await openProducts('v_kalki', 'Kalki Studio')
    await user.click(tickFor(AJRAKH))
    await user.click(tickFor(SHIRT))
    const dialog = await openDialog(user, 2)
    // The brand submits the shirt again while the dialog is open.
    const shirt = product(db, 'p_handloom')
    shirt.submittedAt = new Date(Date.parse(shirt.submittedAt) + 60_000).toISOString()
    await user.click(within(dialog).getByRole('button', { name: 'Approve 2 products' }))

    const alert = await screen.findByRole('alert')
    expect(within(alert).getByText('Approved 1 of 2 products from Kalki Studio.')).toBeInTheDocument()
    expect(within(alert).getByRole('listitem')).toHaveTextContent(`${SHIRT}: The brand changed it since you looked. Open it to review the new version.`)
    expect(within(alert).getByRole('link', { name: SHIRT })).toHaveAttribute('href', '/review/product/rev_p_handloom')
    expect(shirt.status).toBe('pending_review')
    expect(product(db, 'p_ajrakh').status).toBe('approved')

    // The new version still waits, unticked.
    await waitFor(() => expect(screen.queryByRole('checkbox', { name: `Select ${AJRAKH}` })).not.toBeInTheDocument())
    expect(tickFor(SHIRT)).not.toBeChecked()
    expect(within(toolbar()).getByText('0 selected')).toBeInTheDocument()
  })

  it('says so when none were approved', async () => {
    const { user, db } = await openProducts('v_kalki', 'Kalki Studio')
    await user.click(tickFor(AJRAKH))
    await user.click(tickFor(DABU))
    const dialog = await openDialog(user, 2)
    product(db, 'p_ajrakh').status = 'rejected'
    product(db, 'p_dabu_skirt').status = 'approved'
    await user.click(within(dialog).getByRole('button', { name: 'Approve 2 products' }))
    const alert = await screen.findByRole('alert')
    expect(within(alert).getByText('None of the 2 products were approved.')).toBeInTheDocument()
    expect(within(alert).getByText('2 not approved:')).toBeInTheDocument()
    expect(within(alert).getAllByRole('listitem')).toHaveLength(2)
  })

  it('keeps the dialog open with the reason, and the ticks, when the request fails', async () => {
    const { user, db } = await openProducts('v_kalki', 'Kalki Studio')
    await user.click(tickFor(AJRAKH))
    await user.click(tickFor(POCHAMPALLY))
    server.use(http.post(ROUTE, () => HttpResponse.json({ error: { code: 'server_error', message: 'Something went wrong on our side. Try again in a moment.', request_id: 'req-test' } }, { status: 500 })))
    const dialog = await openDialog(user, 2)
    await user.click(within(dialog).getByRole('button', { name: 'Approve 2 products' }))

    const alert = await within(dialog).findByRole('alert')
    expect(within(alert).getByText('That did not go through')).toBeInTheDocument()
    expect(within(alert).getByText('Something went wrong on our side. Try again in a moment.')).toBeInTheDocument()
    expect(screen.getByRole('dialog', { name: 'Approve 2 products from Kalki Studio?' })).toBeInTheDocument()
    expect(product(db, 'p_ajrakh').status).toBe('pending_review')
    expect(tickFor(AJRAKH, true)).toBeChecked()
    expect(tickFor(POCHAMPALLY, true)).toBeChecked()
    expect(within(toolbar(true)).getByText('2 selected')).toBeInTheDocument()

    // A validation error from the API is shown the same way.
    server.use(http.post(ROUTE, () => HttpResponse.json({ error: { code: 'validation_error', message: 'Approve up to 50 products at a time.', request_id: 'req-test', details: [{ loc: ['body', 'products'], msg: 'Approve up to 50 products at a time.', type: 'value_error' }] } }, { status: 422 })))
    await user.click(within(dialog).getByRole('button', { name: 'Approve 2 products' }))
    expect(await within(dialog).findByText('Approve up to 50 products at a time.')).toBeInTheDocument()

    // Offline, then back: trying again goes through.
    server.use(http.post(ROUTE, () => HttpResponse.error()))
    await user.click(within(dialog).getByRole('button', { name: 'Approve 2 products' }))
    expect(await within(dialog).findByText('You seem to be offline. Check your connection and try again.')).toBeInTheDocument()
    server.resetHandlers()
    await user.click(within(dialog).getByRole('button', { name: 'Approve 2 products' }))
    expect(await screen.findByText('Approved 2 products from Kalki Studio. They are being published to the Shazlo app.')).toBeInTheDocument()
    expect(product(db, 'p_ajrakh').status).toBe('approved')
  })

  it('sends nothing on Cancel or Escape', async () => {
    const { user, db } = await openProducts('v_kalki', 'Kalki Studio')
    const bodies = spyOnApprove()
    await user.click(tickFor(DABU))
    await user.click(tickFor(SHIRT))

    const dialog = await openDialog(user, 2)
    await user.click(within(dialog).getByRole('button', { name: 'Cancel' }))
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
    await waitFor(() => expect(within(toolbar()).getByRole('button', { name: 'Approve 2 products' })).toHaveFocus())

    expect(await openDialog(user, 2)).toBeInTheDocument()
    await user.keyboard('{Escape}')
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())

    expect(bodies).toEqual([])
    expect(product(db, 'p_dabu_skirt').status).toBe('pending_review')
    expect(product(db, 'p_handloom').status).toBe('pending_review')
    expect(within(toolbar()).getByText('2 selected')).toBeInTheDocument()
  })

  it('works from the keyboard: Space ticks, Tab moves on, Enter approves', async () => {
    const { user, db } = await openProducts('v_kalki', 'Kalki Studio')
    // A row's tick is its own stop, before the row's link.
    tickFor(AJRAKH).focus()
    await user.keyboard(' ')
    expect(tickFor(AJRAKH)).toBeChecked()
    await user.tab()
    expect(within(list()).getByRole('link', { name: new RegExp(AJRAKH) })).toHaveFocus()

    const all = within(toolbar()).getByRole('checkbox', { name: 'Select all 4 waiting products' })
    all.focus()
    await user.keyboard(' ')
    expect(all).toBeChecked()
    await user.tab()
    const approve = within(toolbar()).getByRole('button', { name: 'Approve 4 products' })
    expect(approve).toHaveFocus()
    await user.keyboard('{Enter}')
    const dialog = await screen.findByRole('dialog', { name: 'Approve 4 products from Kalki Studio?' })
    // The theme makes dialog content a tab stop, so a long list scrolls from the keyboard.
    await user.tab()
    expect(dialog.querySelector('.MuiDialogContent-root')).toHaveFocus()
    await user.tab()
    expect(within(dialog).getByRole('button', { name: 'Cancel' })).toHaveFocus()
    await user.tab()
    expect(within(dialog).getByRole('button', { name: 'Approve 4 products' })).toHaveFocus()
    await user.keyboard('{Enter}')
    expect(await screen.findByText('Approved 4 products from Kalki Studio. They are being published to the Shazlo app.')).toBeInTheDocument()
    expect(db.products.filter((p) => p.vendorId === 'v_kalki' && p.status === 'approved')).toHaveLength(4)
  })

  it('approves up to 50 at a time', async () => {
    // 47 more waiting from Kalki Studio: 51 in all.
    const { user } = await openProducts('v_kalki', 'Kalki Studio', (db) => {
      const ajrakh = product(db, 'p_ajrakh')
      for (let i = 1; i <= 47; i += 1) db.products.push({ ...structuredClone(ajrakh), id: `p_extra_${i}`, submitted: { ...structuredClone(ajrakh.submitted), title: `Extra kurta ${i}` } })
    })
    await user.click(within(toolbar()).getByRole('checkbox', { name: 'Select all 51 waiting products' }))
    expect(within(toolbar()).getByText('51 selected')).toBeInTheDocument()
    const approve = within(toolbar()).getByRole('button', { name: 'Approve 51 products' })
    expect(approve).toBeDisabled()
    expect(approve).toHaveAccessibleDescription('Approve up to 50 products at a time. Untick some to go on.')
    await user.click(tickFor('Extra kurta 47'))
    expect(within(toolbar()).getByRole('button', { name: 'Approve 50 products' })).toBeEnabled()
    expect(screen.queryByText('Approve up to 50 products at a time. Untick some to go on.')).not.toBeInTheDocument()
  })

  it('fills the screen with the dialog on a phone', async () => {
    setViewport(390)
    const { user } = await openProducts('v_kalki', 'Kalki Studio')
    // 44 px to touch: a 24 px box with 10 px around it, and the toolbar's button.
    const boxes = [within(toolbar()).getByRole('checkbox'), ...within(list()).getAllByRole('checkbox')]
    expect(boxes).toHaveLength(5)
    for (const box of boxes) {
      const target = box.closest('.MuiCheckbox-root')!
      expect(['top', 'right', 'bottom', 'left'].map((side) => phoneStyle(target, `padding-${side}`))).toEqual(['10px', '10px', '10px', '10px'])
      // MUI's 9 px from 900 px (a 42 px box): the helper does read the media rules.
      expect(styleAt(1024, target, 'padding-top')).toBe('9px')
    }
    expect(phoneStyle(within(toolbar()).getByRole('button', { name: 'Approve selected' }), 'min-height')).toBe('44px')

    await user.click(tickFor(AJRAKH))
    const dialog = await openDialog(user, 1)
    expect(dialog).toHaveClass('MuiDialog-paperFullScreen')
    for (const name of ['Cancel', 'Approve 1 product']) expect(phoneStyle(within(dialog).getByRole('button', { name }), 'min-height')).toBe('44px')
    // Every tick is still outside its row's link.
    const rows = screen.getByRole('list', { name: 'Products from this vendor', hidden: true })
    for (const box of within(rows).getAllByRole('checkbox', { hidden: true })) expect(box.closest('a')).toBeNull()
  })
})
