import { expect, test } from '@playwright/test'
import { box, expectAccessible, focusInCardActions, isActive, mockToken, moduleFrame, openInShell, resetMock, signIn, vendorsModule } from './support'

// Issue #268: the per-brand commission card (A-09), the vendors list's "Rate to review" tab and
// the queue's line, in a real browser inside Shazlo One, at phone, tablet and desktop widths.

test.beforeEach(async ({ page, request }) => {
  await resetMock(request)
  await signIn(page)
})

test('the card is the first thing on one column, and beside the application on desktop', async ({ page }, info) => {
  await openInShell(page, '/vendors/v_rangrez', 'Rangrez Studio')
  const m = vendorsModule(page)
  const card = await box(m.getByRole('region', { name: 'Commission', exact: true }))
  const application = await box(m.getByRole('region', { name: 'Application', exact: true }))
  if (info.project.name === 'desktop') {
    expect(card.x).toBeGreaterThanOrEqual(application.x + application.width)
  } else {
    expect(card.y + card.height).toBeLessThanOrEqual(application.y)
  }
  // A waiting proposal is seen without scrolling.
  expect(card.y).toBeLessThan(page.viewportSize()!.height)
})

test('approving a proposal shows the agreed rate and keeps keyboard focus on the card', async ({ page }) => {
  await openInShell(page, '/vendors/v_indigo', 'Indigo Loom')
  const m = vendorsModule(page)
  const card = m.getByRole('region', { name: 'Commission', exact: true })
  await card.getByRole('button', { name: 'Approve 10%' }).focus()
  await page.keyboard.press('Enter')
  await expect(m.getByText('Agreed 10% with Indigo Loom. They see it in their store details.')).toBeVisible()
  await expect(card.getByText('10%', { exact: true })).toBeVisible()
  await expect(card.getByRole('button', { name: 'Change rate' })).toBeEnabled()
  // The button it was on went away; focus lands on the card's actions, not the page.
  await expect.poll(() => focusInCardActions(page)).toBe(true)
})

test('after a decision made in a dialog, keyboard focus lands on the card', async ({ page }) => {
  await openInShell(page, '/vendors/v_rangrez', 'Rangrez Studio')
  const m = vendorsModule(page)
  const opener = m.getByRole('region', { name: 'Commission', exact: true }).getByRole('button', { name: 'Send back' })
  await opener.focus()
  await page.keyboard.press('Enter')
  const dialog = m.getByRole('dialog')
  const note = dialog.getByRole('textbox', { name: 'Note to the brand' })
  await expect.poll(() => isActive(note)).toBe(true)
  await note.fill('We can agree 12% once you switch to Shazlo delivery.')
  const confirm = dialog.getByRole('button', { name: 'Send back' })
  await confirm.focus()
  await page.keyboard.press('Enter')
  await expect(dialog).toBeHidden()
  // "Send back", where the dialog would return focus, is gone from a sent-back card.
  await expect(m.getByText('Sent back: waiting for the brand.')).toBeVisible()
  await expect.poll(() => focusInCardActions(page)).toBe(true)
})

test('rotating a tablet across 900 px keeps an open dialog and what was typed', async ({ page }, info) => {
  test.skip(info.project.name !== 'tablet', 'Starts in a one-column tablet frame and turns to landscape.')
  await openInShell(page, '/vendors/v_rangrez', 'Rangrez Studio')
  const m = vendorsModule(page)
  await m.getByRole('region', { name: 'Commission', exact: true }).getByRole('button', { name: 'Send back' }).click()
  const dialog = m.getByRole('dialog')
  const note = dialog.getByRole('textbox', { name: 'Note to the brand' })
  await note.fill('Half written on the train')
  // Landscape: the module frame passes 900 px and the card moves to the side column. (Behind an
  // open dialog the page is hidden from the accessibility tree, so check the card after closing.)
  await page.setViewportSize({ width: 1280, height: 768 })
  await page.waitForTimeout(500)
  await expect(dialog).toBeVisible()
  await expect(note).toHaveValue('Half written on the train')
  await dialog.getByRole('button', { name: 'Cancel' }).click()
  await expect(dialog).toBeHidden()
  const card = await box(m.getByRole('region', { name: 'Commission', exact: true }))
  const application = await box(m.getByRole('region', { name: 'Application', exact: true }))
  expect(card.x).toBeGreaterThanOrEqual(application.x + application.width)
})

test('send back needs a note; on a phone the dialog’s buttons are full width and touch-sized', async ({ page }, info) => {
  await openInShell(page, '/vendors/v_rangrez', 'Rangrez Studio')
  const m = vendorsModule(page)
  await m.getByRole('region', { name: 'Commission', exact: true }).getByRole('button', { name: 'Send back' }).click()
  const dialog = m.getByRole('dialog', { name: 'Send back Rangrez Studio’s proposed rate' })
  await expect(dialog).toBeVisible()
  const confirm = dialog.getByRole('button', { name: 'Send back' })
  const cancel = dialog.getByRole('button', { name: 'Cancel' })
  if (info.project.name === 'phone') {
    const content = await box(dialog.locator('.MuiDialogContent-root'))
    for (const button of [confirm, cancel]) {
      const b = await box(button)
      expect(b.height).toBeGreaterThanOrEqual(44)
      expect(b.width).toBeGreaterThanOrEqual(content.width - 32 - 1)
    }
    // The confirm comes first, above Cancel.
    expect((await box(confirm)).y).toBeLessThan((await box(cancel)).y)
  }
  await confirm.click()
  await expect(dialog.getByText('Write at least 10 characters.')).toBeVisible()
  await dialog.getByRole('textbox', { name: 'Note to the brand' }).fill('We can agree 12% once you switch to Shazlo delivery.')
  await confirm.click()
  await expect(dialog).toBeHidden()
  const card = m.getByRole('region', { name: 'Commission', exact: true })
  await expect(card.getByText('Sent back: waiting for the brand.')).toBeVisible()
  await expect(card.getByText(/^Note from Priya Mehta, /)).toBeVisible()
})

test('a rate sent back by someone else shows whose note it is', async ({ page }) => {
  await openInShell(page, '/vendors/v_sutra', 'Sutra Collective')
  const card = vendorsModule(page).getByRole('region', { name: 'Commission', exact: true })
  await expect(card.getByText('Sent back: waiting for the brand.')).toBeVisible()
  await expect(card.getByText(/^Note from Rahul Desai, /)).toBeVisible()
  await expect(card.getByText(/^We cannot go to 8% for handloom sarees yet\./)).toBeVisible()
  await expect(card.getByText(/^Your note/)).toHaveCount(0)
})

test('setting a rate for a brand with none takes "12,5"; the hint is not squeezed into the 240 px box', async ({ page }, info) => {
  await openInShell(page, '/vendors/v_kesariya', 'Kesariya Prints')
  const m = vendorsModule(page)
  await m.getByRole('region', { name: 'Commission', exact: true }).getByRole('button', { name: 'Set rate' }).click()
  const dialog = m.getByRole('dialog', { name: 'Set the commission for Kesariya Prints' })
  if (info.project.name !== 'phone') {
    // The rate box stays narrow, but its hint (and errors) may use the dialog's width.
    const input = await box(dialog.getByRole('textbox', { name: 'Commission' }))
    const hint = await box(dialog.getByText('Shazlo’s share of each sale, like 12 or 12.5'))
    expect(input.width).toBeLessThanOrEqual(240)
    expect(hint.width).toBeGreaterThan(input.width + 40)
  }
  // Opened with the mouse, the rate field has focus: the reviewer types straight away.
  await expect.poll(() => isActive(dialog.getByRole('textbox', { name: 'Commission' }))).toBe(true)
  await page.keyboard.type('12,5')
  await dialog.getByRole('button', { name: 'Save rate' }).click()
  await expect(dialog).toBeHidden()
  await expect(m.getByRole('region', { name: 'Commission', exact: true }).getByText('12.5%', { exact: true })).toBeVisible()
})

test('"Review rates" in the queue opens the Rate to review tab, fully in view', async ({ page }) => {
  await openInShell(page, '/queue', 'Review queue')
  const m = vendorsModule(page)
  // Indigo Loom and Rangrez Studio, and Saanjh Label's application.
  await expect(m.getByText('3 brands proposed a commission rate.')).toBeVisible()
  await m.getByRole('link', { name: 'Review rates' }).click()
  const tab = m.getByRole('tab', { name: /^Rate to review/, selected: true })
  await expect(tab).toBeVisible()
  await expect(m.getByText('Rangrez Studio')).toBeVisible()
  // The selected tab sits wholly inside the tab strip's scroll area, not half under its edge.
  await expect
    .poll(() =>
      tab.evaluate((el) => {
        const scroller = el.closest('.MuiTabs-scroller')!.getBoundingClientRect()
        const t = el.getBoundingClientRect()
        return t.left >= scroller.left - 1 && t.right <= scroller.right + 1
      }),
    )
    .toBe(true)
})

test('the vendors table gives brand names room on a laptop', async ({ page }, info) => {
  test.skip(info.project.name !== 'desktop', 'The table is drawn from 900 px; phones and tablets get cards.')
  await openInShell(page, '/vendors', 'Vendors')
  const m = vendorsModule(page)
  const table = m.getByRole('table')
  await expect(table).toBeVisible()
  // The brand column has room for a name (before the fix it had the least of any column, 136 px of
  // 942, and "Ambar Textiles" took two lines and its city two more). Only the longest names may take
  // a second line, and the table still fits without sideways scrolling.
  const names = table.locator('tbody tr td:first-child a')
  await expect(names.first()).toBeVisible()
  const brandWidth = await table.locator('thead th').first().evaluate((th) => th.getBoundingClientRect().width)
  expect(brandWidth).toBeGreaterThanOrEqual(160)
  const heights = await names.evaluateAll((links) => links.map((a) => ({ name: a.textContent, lines: Math.round(a.getBoundingClientRect().height / parseFloat(getComputedStyle(a).lineHeight)) })))
  expect(heights.filter((h) => h.lines > 2)).toEqual([])
  expect(heights.filter((h) => h.lines === 1).length).toBeGreaterThanOrEqual(heights.length - 2)
  const overflow = await table.evaluate((el) => el.parentElement!.scrollWidth - el.parentElement!.clientWidth)
  expect(overflow).toBeLessThanOrEqual(0)
})

// Trying to break it.

test('a real double click on Approve sends one request and shows no error', async ({ page }) => {
  await openInShell(page, '/vendors/v_indigo', 'Indigo Loom')
  const m = vendorsModule(page)
  // Count what the module actually sends: a second approve would be refused by the API anyway
  // (409), so the outbox alone cannot show a duplicate; its error banner or request can.
  const approvals: string[] = []
  page.on('request', (r) => {
    if (r.method() === 'POST' && r.url().includes('/commission/approve')) approvals.push(r.url())
  })
  await m.getByRole('region', { name: 'Commission', exact: true }).getByRole('button', { name: 'Approve 10%' }).dblclick()
  await expect(m.getByText('Agreed 10% with Indigo Loom. They see it in their store details.')).toBeVisible()
  // Give a late second request time to come back as a 409 banner.
  await page.waitForLoadState('networkidle')
  await page.waitForTimeout(500)
  expect(approvals).toHaveLength(1)
  await expect(m.getByRole('alert')).toHaveCount(0)
  await expect(m.getByText('Agreed 10% with Indigo Loom. They see it in their store details.')).toBeVisible()
})

test('a 600-character note with no spaces wraps inside the card', async ({ page }) => {
  await openInShell(page, '/vendors/v_indigo', 'Indigo Loom')
  const m = vendorsModule(page)
  await m.getByRole('region', { name: 'Commission', exact: true }).getByRole('button', { name: 'Send back' }).click()
  const dialog = m.getByRole('dialog')
  await dialog.getByRole('textbox', { name: 'Note to the brand' }).fill('x'.repeat(600))
  await dialog.getByRole('button', { name: 'Send back' }).click()
  await expect(dialog).toBeHidden()
  const card = m.getByRole('region', { name: 'Commission', exact: true })
  await expect(card.getByText('x'.repeat(600))).toBeVisible()
  const frame = moduleFrame(page)
  expect(await frame.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBeLessThanOrEqual(0)
  const cardBox = await box(card)
  const quoteBox = await box(card.getByText('x'.repeat(600)))
  expect(quoteBox.x + quoteBox.width).toBeLessThanOrEqual(cardBox.x + cardBox.width)
})

test('Escape closes a dialog without deciding and gives focus back to its button', async ({ page, request }) => {
  await openInShell(page, '/vendors/v_rangrez', 'Rangrez Studio')
  const m = vendorsModule(page)
  const sendBack = m.getByRole('region', { name: 'Commission', exact: true }).getByRole('button', { name: 'Send back' })
  await sendBack.focus()
  await page.keyboard.press('Enter')
  const dialog = m.getByRole('dialog')
  await expect.poll(() => isActive(dialog.getByRole('textbox', { name: 'Note to the brand' }))).toBe(true)
  await page.keyboard.type('half a note')
  await page.keyboard.press('Escape')
  await expect(dialog).toBeHidden()
  await expect.poll(() => isActive(sendBack)).toBe(true)
  const vendor = await (await request.get('http://localhost:5194/api/v1/admin/vendors/v_rangrez', { headers: { authorization: `Bearer ${mockToken()}` } })).json()
  expect(vendor.commission.state).toBe('proposed')
})

test('the vendor page with a proposal waiting has no serious accessibility problems', async ({ page }, info) => {
  await openInShell(page, '/vendors/v_indigo', 'Indigo Loom')
  await expectAccessible(page, info)
})
