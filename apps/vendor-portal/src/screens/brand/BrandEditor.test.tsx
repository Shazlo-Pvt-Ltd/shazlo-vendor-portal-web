import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { delay, http, HttpResponse } from 'msw'
import { describe, expect, it } from 'vitest'
import type { MockDb } from '../../mocks/db'
import { swatch } from '../../mocks/swatch'
import { renderApp, type Viewport } from '../../test/render'
import { server } from '../../test/server'

// Seed (src/mocks/db.ts): the draft changes the story and the cover; everything else matches the live page.
const LIVE_TAGLINE = 'Hand block-printed, naturally dyed.'
const LIVE_STORY = 'We work with Ajrakh printers in Kutch and dye every metre with indigo, madder and pomegranate rind.'
const DRAFT_STORY = `${LIVE_STORY} Small batches, made to last.`
const AUTOSAVE_WAIT = { timeout: 4000 }

async function openBrandPage({ viewport, prepare }: { viewport?: Viewport; prepare?: (db: MockDb) => void } = {}) {
  const view = await renderApp({ route: '/brand', viewport })
  // The editor is lazy-loaded, so the seed can still be changed before its first request.
  prepare?.(view.db)
  await screen.findByRole('textbox', { name: /^Tagline/ })
  return view
}

// The shared storage mock reads the multipart body, and Node's fetch cannot parse a jsdom File
// (undici assertion). Until that handler tolerates it, answer the storage step without reading the body.
function stubStorageUpload(db: MockDb) {
  server.use(
    http.post('*/mock-uploads/:key', ({ params }) => {
      const url = swatch(String(params.key))
      db.uploads.set(String(params.key), url)
      return HttpResponse.json({ key: params.key, secure_url: url })
    }),
  )
}

const preview = () => screen.getByRole('region', { name: 'Preview in the Shazlo app' })
const textbox = (name: string | RegExp) => screen.getByRole('textbox', { name })
const pause = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))
// Tests that wait out the 1 s autosave get extra room on slow machines.
const SLOW = 25_000

async function replace(user: Awaited<ReturnType<typeof renderApp>>['user'], field: HTMLElement, text: string) {
  await user.clear(field)
  if (text) await user.paste(text)
}

describe('V-05 Brand page', () => {
  it('shows skeletons shaped like the form and the phone while loading', async () => {
    // Hold the answer back; returning nothing hands the request on to the shared mock.
    server.use(http.get('*/api/v1/vendor/brand-page', () => delay(300)))
    await renderApp({ route: '/brand' })
    // The screen is lazy-loaded; the first import can take a while on a cold run.
    const loading = await screen.findByRole('status', { name: 'Loading your brand page' }, { timeout: 8000 })
    expect(loading).toHaveAttribute('aria-busy', 'true')
    expect(screen.getByRole('heading', { level: 1, name: 'Brand page' })).toBeInTheDocument()
    expect(await screen.findByRole('textbox', { name: /^Tagline/ })).toBeInTheDocument()
    expect(screen.queryByRole('status', { name: 'Loading your brand page' })).toBeNull()
  })

  it('loads the draft and tags the fields that differ from the live page', async () => {
    await openBrandPage()
    expect(screen.getByRole('heading', { level: 1, name: 'Brand page' })).toBeInTheDocument()
    expect(within(screen.getByRole('navigation', { name: 'Breadcrumb' })).getByText('Edit draft')).toHaveAttribute('aria-current', 'page')
    expect(screen.getByText('Draft · 2 changes')).toBeInTheDocument()
    expect(screen.getByText('Changes are saved as a draft. Your live page stays the same until our team approves the draft.')).toBeInTheDocument()
    expect(screen.getByText('Saved · 40 min ago')).toBeInTheDocument()

    const identity = screen.getByRole('region', { name: 'Identity' })
    const brandName = within(identity).getByRole('textbox', { name: 'Brand name' })
    expect(brandName).toBeDisabled()
    expect(brandName).toHaveValue('Kalki Studio')
    expect(brandName).toHaveAccessibleDescription('Contact us to change your brand name.')
    expect(within(identity).getByRole('textbox', { name: 'Based in' })).toHaveValue('Ahmedabad, Gujarat')
    expect(within(identity).getByRole('textbox', { name: 'Tagline' })).toHaveValue(LIVE_TAGLINE)
    expect(within(identity).getByRole('textbox', { name: 'Story Changed' })).toHaveValue(DRAFT_STORY)
    expect(within(identity).getByRole('group', { name: 'Logo' })).toHaveTextContent('Square PNG or JPG, at least 400 × 400 px.')
    const cover = within(identity).getByRole('group', { name: 'Cover image Changed' })
    expect(cover).toHaveTextContent('Shown at the top of your page in the app. 1600 × 600 px recommended. Avoid text on the image.')
    expect(within(cover).getByRole('img', { name: 'Cover image preview' })).toBeInTheDocument()
    expect(within(cover).getByRole('button', { name: 'Replace cover image' })).toBeInTheDocument()
    expect(within(identity).getByRole('button', { name: 'Upload logo' })).toBeInTheDocument()

    const shopping = screen.getByRole('region', { name: 'Shopping details' })
    expect(within(shopping).getByRole('combobox', { name: /^Return policy/ })).toHaveTextContent('7-day returns, unworn with tags')
    expect(within(shopping).getByRole('combobox', { name: /^Dispatch time/ })).toHaveTextContent('Ships in 2–3 days')
    expect(within(shopping).getByRole('textbox', { name: 'Instagram' })).toHaveValue('@kalki.studio')
    expect(within(shopping).getByRole('textbox', { name: 'Website (optional)' })).toHaveValue('kalkistudio.in')

    expect(screen.getAllByText('Changed')).toHaveLength(2)
    expect(screen.getByRole('button', { name: 'Discard draft' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Submit for review' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Show preview' })).toBeNull()
  })

  it('counts characters and moves the Changed tags as you type', async () => {
    const { user } = await openBrandPage()
    const tagline = textbox('Tagline')
    const story = textbox('Story Changed')
    expect(tagline).toHaveAccessibleDescription('35 / 60')
    expect(story).toHaveAccessibleDescription(`${DRAFT_STORY.length} / 600`)

    await user.type(tagline, ' Since 2012.')
    expect(textbox('Tagline Changed')).toBe(tagline)
    expect(tagline).toHaveAccessibleDescription('47 / 60')
    expect(screen.getByText('Draft · 3 changes')).toBeInTheDocument()

    await user.type(tagline, '{Backspace}'.repeat(12))
    expect(textbox('Tagline')).toBe(tagline)

    await replace(user, story, LIVE_STORY)
    expect(textbox('Story')).toBe(story)
    expect(screen.getByText('Draft · 1 change')).toBeInTheDocument()
    expect(screen.getAllByText('Changed')).toHaveLength(1)
  }, SLOW)

  it('saves the draft a second after typing stops', async () => {
    const { user, db } = await openBrandPage()
    const basedIn = textbox('Based in')
    await user.clear(basedIn)
    await user.type(basedIn, 'Bhuj, Gujarat')
    expect(db.brand.draft?.based_in).toBe('Ahmedabad, Gujarat')

    await waitFor(() => expect(db.brand.draft?.based_in).toBe('Bhuj, Gujarat'), AUTOSAVE_WAIT)
    // The whole profile goes up, so the earlier draft changes stay.
    expect(db.brand.draft?.story).toBe(DRAFT_STORY)
    expect(await screen.findByText('Saved · just now')).toBeInTheDocument()
    expect(screen.getByText('Draft · 3 changes')).toBeInTheDocument()
  }, SLOW)

  it('points out problems and holds the autosave until they are fixed', async () => {
    const { user, db } = await openBrandPage()
    const tagline = textbox('Tagline')
    await replace(user, tagline, 'Hand block-printed in Kutch, naturally dyed with indigo and madder.')
    expect(tagline).toHaveAttribute('aria-invalid', 'true')
    expect(tagline).toHaveAccessibleDescription('Keep the tagline to 60 characters. 67 / 60')

    const instagram = textbox('Instagram')
    await replace(user, instagram, 'kalki.studio')
    expect(instagram).toHaveAttribute('aria-invalid', 'true')
    expect(instagram).toHaveAccessibleDescription('Start your handle with @, like @kalki.studio.')

    const website = textbox('Website (optional)')
    await replace(user, website, 'kalki studio')
    expect(website).toHaveAccessibleDescription('Enter a web address like kalkistudio.in.')

    await pause(1500)
    expect(db.brand.draft?.tagline).toBe(LIVE_TAGLINE)
    expect(db.brand.draft?.instagram).toBe('@kalki.studio')

    await replace(user, tagline, 'Block-printed in Kutch.')
    await replace(user, instagram, '@kalkistudio')
    await replace(user, website, '')
    expect(tagline).toHaveAttribute('aria-invalid', 'false')
    expect(website).toHaveAttribute('aria-invalid', 'false')
    await waitFor(() => expect(db.brand.draft?.instagram).toBe('@kalkistudio'), AUTOSAVE_WAIT)
    expect(db.brand.draft?.tagline).toBe('Block-printed in Kutch.')
    expect(db.brand.draft?.website).toBe('')
  }, SLOW)

  it('previews the draft as you type and shows the live page behind the switch', async () => {
    const { user } = await openBrandPage()
    const phone = preview()
    expect(within(phone).getByText('Kalki Studio')).toBeInTheDocument()
    expect(within(phone).getByText(LIVE_TAGLINE)).toBeInTheDocument()
    expect(within(phone).getByText('Ahmedabad')).toBeInTheDocument()
    expect(within(phone).getByText('Ships in 2–3 days')).toBeInTheDocument()
    expect(within(phone).getByText('7-day returns')).toBeInTheDocument()
    expect(within(phone).getByText(DRAFT_STORY)).toBeInTheDocument()
    expect(within(phone).getByText('Product tiles show only approved products.')).toBeInTheDocument()
    expect(await within(phone).findByText('Bandhani Silk Dupatta')).toBeInTheDocument()
    expect(within(phone).getAllByRole('listitem')).toHaveLength(4)

    const version = within(phone).getByRole('group', { name: 'Preview version' })
    expect(within(version).getByRole('button', { name: 'Draft' })).toHaveAttribute('aria-pressed', 'true')

    await replace(user, textbox('Tagline'), 'Ajrakh from Kutch.')
    expect(within(phone).getByText('Ajrakh from Kutch.')).toBeInTheDocument()

    await user.click(screen.getByRole('combobox', { name: /^Dispatch time/ }))
    await user.click(await screen.findByRole('option', { name: 'Ships in 3–5 days' }))
    expect(screen.getByRole('combobox', { name: /^Dispatch time Changed/ })).toHaveTextContent('Ships in 3–5 days')
    expect(within(phone).getByText('Ships in 3–5 days')).toBeInTheDocument()

    await user.click(within(version).getByRole('button', { name: 'Live' }))
    expect(within(version).getByRole('button', { name: 'Live' })).toHaveAttribute('aria-pressed', 'true')
    expect(within(phone).getByText(LIVE_TAGLINE)).toBeInTheDocument()
    expect(within(phone).getByText(LIVE_STORY)).toBeInTheDocument()
    expect(within(phone).getByText('Ships in 2–3 days')).toBeInTheDocument()
    expect(within(phone).queryByText('Ajrakh from Kutch.')).toBeNull()

    await user.click(within(version).getByRole('button', { name: 'Draft' }))
    expect(within(phone).getByText('Ajrakh from Kutch.')).toBeInTheDocument()
  })

  it('discards the draft only after asking', async () => {
    const { user, db } = await openBrandPage()
    await user.click(screen.getByRole('button', { name: 'Discard draft' }))
    let dialog = await screen.findByRole('dialog', { name: 'Discard your draft?' })
    expect(dialog).toHaveTextContent('Your live page stays as it is. This cannot be undone.')
    await user.click(within(dialog).getByRole('button', { name: 'Keep editing' }))
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
    expect(db.brand.draft).not.toBeNull()
    expect(textbox('Story Changed')).toHaveValue(DRAFT_STORY)

    await user.click(screen.getByRole('button', { name: 'Discard draft' }))
    dialog = await screen.findByRole('dialog', { name: 'Discard your draft?' })
    await user.click(within(dialog).getByRole('button', { name: 'Discard draft' }))
    expect(await screen.findByText('Draft discarded. Your page matches the live version again.')).toBeInTheDocument()
    expect(db.brand.draft).toBeNull()
    expect(textbox('Story')).toHaveValue(LIVE_STORY)
    expect(screen.queryAllByText('Changed')).toHaveLength(0)
    expect(screen.getByText('Live', { selector: '[data-status="live"]' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Discard draft' })).toBeNull()
  })

  it('saves the last edit, sends the draft for review and locks the page while it waits', async () => {
    const { user, db } = await openBrandPage()
    const tagline = textbox('Tagline')
    await replace(user, tagline, 'Ajrakh from Kutch.')
    // Straight to submit: the pending autosave is flushed first.
    await user.click(screen.getByRole('button', { name: 'Submit for review' }))

    const banner = await screen.findByText('Sent for review. Your live page stays as it is until we approve the changes.')
    expect(banner).toBeInTheDocument()
    expect(db.brand.review.state).toBe('waiting')
    expect(db.brand.draft?.tagline).toBe('Ajrakh from Kutch.')
    expect(screen.getByText('Pending review', { selector: '[data-status="pending"]' })).toBeInTheDocument()
    expect(tagline).toBeDisabled()
    expect(textbox(/^Story/)).toBeDisabled()
    expect(screen.getByRole('combobox', { name: /^Return policy/ })).toHaveAttribute('aria-disabled', 'true')
    expect(screen.getByRole('button', { name: 'Replace cover image' })).toBeDisabled()
    expect(screen.queryByRole('button', { name: 'Submit for review' })).toBeNull()
    expect(screen.queryByRole('button', { name: 'Discard draft' })).toBeNull()
  }, SLOW)

  it('opens read-only while the page is in review', async () => {
    await openBrandPage({ prepare: (db) => { db.brand.review = { state: 'waiting', at: new Date().toISOString() } } })
    expect(screen.getByText('Your brand page is in review. You can edit it again once our team has decided — usually within 24 hours.')).toBeInTheDocument()
    expect(screen.getByText('Pending review', { selector: '[data-status="pending"]' })).toBeInTheDocument()
    expect(textbox('Tagline')).toBeDisabled()
    expect(textbox('Instagram')).toBeDisabled()
    expect(screen.queryByRole('button', { name: 'Submit for review' })).toBeNull()
    expect(screen.queryByRole('button', { name: 'Discard draft' })).toBeNull()
  })

  it('quotes the reviewer when the page was sent back', async () => {
    const reason = 'The cover image has text on it. Use a photo without words.'
    await openBrandPage({ prepare: (db) => { db.brand.review = { state: 'rejected', reason, at: new Date().toISOString() } } })
    const alert = screen.getByRole('alert')
    expect(alert).toHaveTextContent('Our team sent your brand page back.')
    expect(alert).toHaveTextContent(reason)
    expect(textbox('Tagline')).toBeEnabled()
    expect(screen.getByRole('button', { name: 'Submit for review' })).toBeEnabled()
  })

  it('marks the field the reviewer needs when the submit is refused (422)', async () => {
    const { user, db } = await openBrandPage({ prepare: (db) => { db.brand.draft!.story = '' } })
    await user.click(screen.getByRole('button', { name: 'Submit for review' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('Check the highlighted fields.')
    const story = textbox(/^Story/)
    expect(story).toHaveAttribute('aria-invalid', 'true')
    expect(story).toHaveAccessibleDescription('Tell shoppers your story before sending it for review. 0 / 600')
    expect(story).toHaveFocus()
    expect(db.brand.review.state).toBe('approved')
    expect(screen.getByRole('button', { name: 'Submit for review' })).toBeInTheDocument()
  })

  it('replaces the cover with an uploaded photo and saves it to the draft', async () => {
    const { user, db } = await openBrandPage()
    stubStorageUpload(db)
    const before = screen.getByRole('img', { name: 'Cover image preview' }).getAttribute('src')
    await user.upload(screen.getByLabelText('Cover image file'), new File(['cover'], 'cover.png', { type: 'image/png' }))
    await waitFor(() => expect(screen.getByRole('img', { name: 'Cover image preview' }).getAttribute('src')).not.toBe(before))
    const after = screen.getByRole('img', { name: 'Cover image preview' }).getAttribute('src')
    await waitFor(() => expect(db.brand.draft?.cover_url).toBe(after), AUTOSAVE_WAIT)
  }, SLOW)

  it('explains why a photo was not accepted', async () => {
    const { db } = await openBrandPage()
    // The file picker filters by type; a dropped or renamed file can still get through.
    const user = userEvent.setup({ applyAccept: false })
    await user.upload(screen.getByLabelText('Cover image file'), new File(['notes'], 'notes.txt', { type: 'text/plain' }))
    const cover = screen.getByRole('group', { name: /^Cover image/ })
    expect(await within(cover).findByText('Use a JPG, PNG or WebP photo.')).toBeInTheDocument()
    expect(within(cover).getByRole('button', { name: 'Replace cover image' })).toHaveAccessibleDescription(expect.stringContaining('Use a JPG, PNG or WebP photo.'))

    db.failNext = { path: '/uploads/presign', status: 413, code: 'file_too_large', message: 'Photos can be up to 10 MB. Export a smaller copy and try again.' }
    await user.upload(screen.getByLabelText('Logo file'), new File(['logo'], 'logo.png', { type: 'image/png' }))
    const logo = screen.getByRole('group', { name: /^Logo/ })
    expect(await within(logo).findByText('Photos can be up to 10 MB. Export a smaller copy and try again.')).toBeInTheDocument()
    expect(db.brand.draft?.logo_url).toBeNull()
  })

  it('handles a first brand page with nothing live yet', async () => {
    await openBrandPage({
      prepare: (db) => {
        db.brand.live = null
        db.brand.live_since = null
        db.brand.draft = null
        db.brand.draft_saved_at = null
        db.brand.review = { state: 'none' }
      },
    })
    expect(textbox('Brand name')).toHaveValue('Kalki Studio')
    expect(textbox('Tagline')).toHaveValue('')
    expect(screen.getByText('Draft · not live yet')).toBeInTheDocument()
    expect(screen.getByText('Changes are saved as a draft. Your brand page appears in the Shazlo app once our team approves it.')).toBeInTheDocument()
    expect(screen.queryAllByText('Changed')).toHaveLength(0)
    expect(within(preview()).queryByRole('group', { name: 'Preview version' })).toBeNull()
    expect(screen.getByRole('button', { name: 'Submit for review' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Discard draft' })).toBeNull()
  })

  it('offers a retry when the brand page does not load', async () => {
    const { user, db } = await renderApp({ route: '/brand' })
    db.failNext = { path: '/brand-page', status: 403, code: 'forbidden', message: 'Only the store owner can edit the brand page.' }
    const alert = await screen.findByRole('alert')
    expect(alert).toHaveTextContent('We could not load your brand page.')
    expect(alert).toHaveTextContent('Only the store owner can edit the brand page.')
    await user.click(within(alert).getByRole('button', { name: 'Try again' }))
    expect(await screen.findByRole('textbox', { name: 'Tagline' })).toHaveValue(LIVE_TAGLINE)
  })

  it('puts the preview under the form behind a button on phones', async () => {
    const { user } = await openBrandPage({ viewport: 'mobile' })
    expect(screen.queryByRole('region', { name: 'Preview in the Shazlo app' })).toBeNull()
    const toggle = screen.getByRole('button', { name: 'Show preview' })
    expect(toggle).toHaveAttribute('aria-expanded', 'false')
    await user.click(toggle)
    expect(toggle).toHaveAccessibleName('Hide preview')
    expect(toggle).toHaveAttribute('aria-expanded', 'true')
    expect(within(preview()).getByText(DRAFT_STORY)).toBeInTheDocument()
    await user.click(toggle)
    expect(screen.queryByRole('region', { name: 'Preview in the Shazlo app' })).toBeNull()
  })
})
