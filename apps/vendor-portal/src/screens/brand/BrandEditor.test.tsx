import { act, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { delay, http } from 'msw'
import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import { DEMO_STAFF, nextId, type BrandContent, type MockDb } from '../../mocks/db'
import { decide } from '../../mocks/handlers'
import { renderApp, type Viewport } from '../../test/render'
import { server, setupMockApi } from '../../test/server'
import { addNewSeller, NEW_SELLER } from '../overview/testing'

// Seed (src/mocks/db.ts): the draft (version 2) changes the story and the cover; everything else
// matches the live page (version 1).
const LIVE_TAGLINE = 'Hand block-printed, naturally dyed.'
const LIVE_STORY = 'We work with Ajrakh printers in Kutch and dye every metre with indigo, madder and pomegranate rind.'
const DRAFT_STORY = `${LIVE_STORY} Small batches, made to last.`
const AUTOSAVE_WAIT = { timeout: 4000 }
// Tests that wait out the 1 s autosave get extra room on slow machines.
const SLOW = 25_000

// The demo photos are object URLs. Node's look like blob:nodedata:…, which SafeImage rightly refuses;
// a browser's are blob:https://… . Make them look like a browser's, so the previews show.
const nodeObjectUrl = URL.createObjectURL
let objectUrls = 0
URL.createObjectURL = () => `blob:https://seller.shazlo.test/${(objectUrls += 1)}`
afterAll(() => {
  URL.createObjectURL = nodeObjectUrl
})

const { db } = setupMockApi()

// The seed's photos were made when the mock first loaded, before the stub above: give them browser-like addresses too.
beforeEach(() => {
  for (const asset of db().assets.values()) if (asset.url.startsWith('blob:nodedata:')) asset.url = URL.createObjectURL(new Blob())
})

const kalki = () => db().vendors.find((v) => v.name === 'Kalki Studio')!
const versions = (d: MockDb = db()) => d.brands.get(kalki().id)!
const draftOf = (d: MockDb = db()): BrandContent => versions(d).find((v) => v.state === 'draft')!.content
const assetUrl = (id: string | null) => (id ? db().assets.get(id)?.url : undefined)

async function openBrandPage({ viewport, credentials }: { viewport?: Viewport; credentials?: { email: string; password: string } } = {}) {
  const view = await renderApp({ route: '/brand', viewport, credentials })
  await screen.findByRole('textbox', { name: /^Tagline/ }, { timeout: 8000 })
  return view
}

/** The draft goes to review, as POST /brand-profile/submit would send it. */
function sendDraftForReview(d: MockDb) {
  const at = d.now().toISOString()
  const draft = versions(d).find((v) => v.state === 'draft')!
  Object.assign(draft, { state: 'pending_review', submitted_at: at })
  d.submissions.push({ id: nextId(d), vendor_id: kalki().id, subject: 'brand_profile', product_id: null, sku: null, title: null, version: draft.version, status: 'pending', reason: null, submitted_at: at, decided_at: null })
}

const preview = () => screen.getByRole('region', { name: 'Preview in the Shazlo app' })
const textbox = (name: string | RegExp) => screen.getByRole('textbox', { name })
const pause = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

async function replace(user: Awaited<ReturnType<typeof renderApp>>['user'], field: HTMLElement, text: string) {
  await user.clear(field)
  if (text) await user.paste(text)
}

describe('V-05 Brand page: the editor', () => {
  it('shows skeletons shaped like the form and the phone while loading', async () => {
    server.use(http.get('*/v1/vendor/brand-profile', () => delay(300)))
    await renderApp({ route: '/brand' })
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
    expect(within(cover).getByRole('img', { name: 'Cover image preview' })).toHaveAttribute('src', assetUrl(draftOf().banner_asset_id))
    expect(within(cover).getByRole('button', { name: 'Replace cover image' })).toBeInTheDocument()
    expect(within(identity).getByRole('button', { name: 'Upload logo' })).toBeInTheDocument()

    const shopping = screen.getByRole('region', { name: 'Shopping details' })
    // Returns and delivery are store details now (spec §5): one line and a link, nothing to edit here.
    expect(within(shopping).queryByRole('combobox')).toBeNull()
    expect(within(shopping).getByText(/Returns and delivery come from your store details\./)).toBeInTheDocument()
    expect(within(shopping).getByRole('link', { name: 'Change them in Store details' })).toHaveAttribute('href', '/store/details')
    expect(within(shopping).getByRole('textbox', { name: 'Instagram' })).toHaveValue('@kalki.studio')
    expect(within(shopping).getByRole('textbox', { name: 'Website (optional)' })).toHaveValue('https://kalkistudio.in')

    expect(screen.getAllByText('Changed')).toHaveLength(2)
    expect(screen.getByRole('button', { name: 'Discard draft' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Submit for review' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Show preview' })).toBeNull()
    // One yellow button on the page.
    expect(screen.getByRole('main').querySelectorAll('.MuiButton-contained')).toHaveLength(1)
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
    const { user } = await openBrandPage()
    const basedIn = textbox('Based in')
    await user.clear(basedIn)
    await user.type(basedIn, 'Bhuj, Gujarat')
    expect(draftOf().based_in).toBe('Ahmedabad, Gujarat')

    await waitFor(() => expect(draftOf().based_in).toBe('Bhuj, Gujarat'), AUTOSAVE_WAIT)
    // The whole draft goes up (a PUT replaces it), so the earlier changes and what the editor does
    // not show (categories, the price range) stay.
    expect(draftOf()).toMatchObject({ about: DRAFT_STORY, categories: ['kurtas', 'dupattas', 'sarees'], price_min_paise: 89_900 })
    expect(await screen.findByText('Saved · just now')).toBeInTheDocument()
    expect(screen.getByText('Draft · 3 changes')).toBeInTheDocument()
  }, SLOW)

  it('keeps the last edit when the seller leaves within the second', async () => {
    const { user, router } = await openBrandPage()
    await replace(user, textbox('Tagline'), 'Ajrakh from Kutch.')
    await act(() => router.navigate('/products'))
    await waitFor(() => expect(draftOf().tagline).toBe('Ajrakh from Kutch.'), AUTOSAVE_WAIT)
  }, SLOW)

  it('points out problems and holds the autosave until they are fixed', async () => {
    const { user } = await openBrandPage()
    const tagline = textbox('Tagline')
    await replace(user, tagline, 'Hand block-printed in Kutch, naturally dyed with indigo and madder.')
    expect(tagline).toHaveAttribute('aria-invalid', 'true')
    expect(tagline).toHaveAccessibleDescription('Keep the tagline to 60 characters. 67 / 60')

    const instagram = textbox('Instagram')
    await replace(user, instagram, 'kalki studio')
    expect(instagram).toHaveAttribute('aria-invalid', 'true')
    expect(instagram).toHaveAccessibleDescription('Use your Instagram name, like @kalki.studio, or the address of your profile.')

    const website = textbox('Website (optional)')
    await replace(user, website, 'kalki studio')
    expect(website).toHaveAccessibleDescription('Enter a web address like kalkistudio.in.')

    await pause(1500)
    expect(draftOf().tagline).toBe(LIVE_TAGLINE)
    expect(draftOf().instagram_handle).toBe('kalki.studio')

    await replace(user, tagline, 'Block-printed in Kutch.')
    await replace(user, instagram, '@kalkistudio')
    await replace(user, website, '')
    expect(tagline).toHaveAttribute('aria-invalid', 'false')
    expect(website).toHaveAttribute('aria-invalid', 'false')
    await waitFor(() => expect(draftOf().instagram_handle).toBe('kalkistudio'), AUTOSAVE_WAIT)
    expect(draftOf().tagline).toBe('Block-printed in Kutch.')
    expect(draftOf().website_url).toBeNull()
  }, SLOW)

  it('takes an Instagram name without @, or the address of the profile, and says what it saves', async () => {
    const { user } = await openBrandPage()
    const instagram = textbox('Instagram')
    await replace(user, instagram, 'https://www.instagram.com/kalki.handloom/?igsh=abc')
    expect(instagram).toHaveAttribute('aria-invalid', 'false')
    expect(instagram).toHaveAccessibleDescription('We will save this as @kalki.handloom')
    await waitFor(() => expect(draftOf().instagram_handle).toBe('kalki.handloom'), AUTOSAVE_WAIT)
    await replace(user, instagram, 'kalki.studio')
    await waitFor(() => expect(draftOf().instagram_handle).toBe('kalki.studio'), AUTOSAVE_WAIT)
  }, SLOW)

  it('stops at the limits vendor-api keeps, before saving', async () => {
    const { user } = await openBrandPage()
    const basedIn = textbox('Based in')
    await replace(user, basedIn, 'अहमदाबाद '.repeat(14))
    expect(basedIn).toHaveAttribute('aria-invalid', 'true')
    expect(basedIn).toHaveAccessibleDescription('Keep this to 120 characters.')
    const website = textbox('Website (optional)')
    await replace(user, website, `kalkistudio.in/${'a'.repeat(490)}`)
    expect(website).toHaveAccessibleDescription('Keep the web address to 500 characters.')
    await pause(1500)
    expect(draftOf().based_in).toBe('Ahmedabad, Gujarat')
  }, SLOW)

  it('shows a refusal from vendor-api on the field it is about, not as a lost connection', async () => {
    const { user } = await openBrandPage()
    db().faults.push({ path: '/v1/vendor/brand-profile', method: 'PUT', status: 422, code: 'validation_error', message: 'Request validation failed', details: [{ loc: ['body', 'tagline'], msg: 'That tagline uses a word we cannot show.', type: 'value_error' }] })
    const tagline = textbox('Tagline')
    await replace(user, tagline, 'Best kurtas in India.')
    await waitFor(() => expect(tagline).toHaveAccessibleDescription(/That tagline uses a word we cannot show\./), AUTOSAVE_WAIT)
    expect(tagline).toHaveAttribute('aria-invalid', 'true')
    expect(screen.queryByText(/Check your connection/)).toBeNull()
  }, SLOW)

  it('says so when a save does not reach the server, and saves on the next edit', async () => {
    const { user } = await openBrandPage()
    db().faults.push({ path: '/v1/vendor/brand-profile', method: 'PUT', network: true })
    await replace(user, textbox('Tagline'), 'Ajrakh from Kutch.')
    expect(await screen.findByText(/Not saved\. Check your connection/, {}, AUTOSAVE_WAIT)).toBeInTheDocument()
    await user.type(textbox('Tagline Changed'), '!')
    await waitFor(() => expect(draftOf().tagline).toBe('Ajrakh from Kutch.!'), AUTOSAVE_WAIT)
  }, SLOW)

  it('keeps long and non-Latin text whole in the preview', async () => {
    const { user } = await openBrandPage()
    const story = `${'हाथ से छपा, प्राकृतिक रंग। 🌿 '.repeat(18)}`.slice(0, 600)
    await replace(user, textbox('Story Changed'), story)
    expect(textbox('Story Changed')).toHaveAccessibleDescription(`${story.length} / 600`)
    expect(within(preview()).getByText(story.trim())).toHaveStyle({ overflowWrap: 'anywhere' })
  }, SLOW)
})

describe('V-05 Brand page: the preview', () => {
  it('previews the draft as you type and shows the live page behind the switch', async () => {
    const { user } = await openBrandPage()
    const phone = preview()
    expect(within(phone).getByText('Kalki Studio')).toBeInTheDocument()
    expect(within(phone).getByText(LIVE_TAGLINE)).toBeInTheDocument()
    expect(within(phone).getByText('Ahmedabad')).toBeInTheDocument()
    // Delivery and returns come from Store details (the demo store: Shazlo delivery, 7-day returns).
    expect(await within(phone).findByText('Shazlo delivery')).toBeInTheDocument()
    expect(within(phone).getByText('7-day returns')).toBeInTheDocument()
    expect(within(phone).getByText(DRAFT_STORY)).toBeInTheDocument()
    expect(within(phone).getByText('Product tiles show only approved products.')).toBeInTheDocument()
    expect(await within(phone).findByText('Bandhani Silk Dupatta')).toBeInTheDocument()
    expect(within(phone).getAllByRole('listitem')).toHaveLength(4)

    const version = within(phone).getByRole('group', { name: 'Preview version' })
    expect(within(version).getByRole('button', { name: 'Draft' })).toHaveAttribute('aria-pressed', 'true')

    await replace(user, textbox('Tagline'), 'Ajrakh from Kutch.')
    expect(within(phone).getByText('Ajrakh from Kutch.')).toBeInTheDocument()

    await user.click(within(version).getByRole('button', { name: 'Live' }))
    expect(within(version).getByRole('button', { name: 'Live' })).toHaveAttribute('aria-pressed', 'true')
    expect(within(phone).getByText(LIVE_TAGLINE)).toBeInTheDocument()
    expect(within(phone).getByText(LIVE_STORY)).toBeInTheDocument()
    expect(within(phone).queryByText('Ajrakh from Kutch.')).toBeNull()

    await user.click(within(version).getByRole('button', { name: 'Draft' }))
    expect(within(phone).getByText('Ajrakh from Kutch.')).toBeInTheDocument()
  })

  it('shows the product tiles on a vendor-api whose list rows are plain (no proposal)', async () => {
    db().proposals.productSummaries = false
    await openBrandPage()
    expect(await within(preview()).findByText('Bandhani Silk Dupatta')).toBeInTheDocument()
    expect(within(preview()).getAllByRole('listitem')).toHaveLength(4)
  })

  it('shows empty tiles for a brand with nothing approved yet', async () => {
    addNewSeller(db())
    await openBrandPage({ credentials: NEW_SELLER })
    await waitFor(() => expect(within(preview()).queryAllByRole('listitem')).toHaveLength(0))
    expect(within(preview()).getByText('Product tiles show only approved products.')).toBeInTheDocument()
  })

  it('previews the delivery and returns saved in Store details', async () => {
    const store = db().stores.get(kalki().id)!
    store.delivery = { mode: 'own', areas: { all_india: true, places: [] }, delivery_days: '3_5' }
    store.returns = { window_days: 0, condition: null, refund_days: null }
    await openBrandPage()
    const phone = preview()
    expect(await within(phone).findByText('Delivers in 3–5 days')).toBeInTheDocument()
    expect(within(phone).getByText('No returns')).toBeInTheDocument()
  })

  it('links the website and Instagram safely, and never a javascript: address', async () => {
    const { user } = await openBrandPage()
    const phone = preview()
    const website = within(phone).getByRole('link', { name: 'Website' })
    expect(website).toHaveAttribute('href', 'https://kalkistudio.in/')
    expect(website).toHaveAttribute('rel', 'noopener noreferrer')
    expect(within(phone).getByRole('link', { name: '@kalki.studio' })).toHaveAttribute('href', 'https://www.instagram.com/kalki.studio')

    await replace(user, textbox('Website (optional)'), 'javascript:alert(1)')
    expect(textbox(/^Website/)).toHaveAttribute('aria-invalid', 'true')
    expect(phone.querySelector('a[href^="javascript"]')).toBeNull()
    // A bare address is shown as the https one it will be saved as.
    await replace(user, textbox(/^Website/), 'kalkistudio.in/shop')
    expect(within(phone).getByRole('link', { name: 'Website' })).toHaveAttribute('href', 'https://kalkistudio.in/shop')
  })

  it('never renders what the seller typed as markup', async () => {
    const { user } = await openBrandPage()
    await replace(user, textbox('Tagline'), '<img src=x onerror=alert(1)><b>bold</b>')
    const phone = preview()
    expect(within(phone).getByText('<img src=x onerror=alert(1)><b>bold</b>')).toBeInTheDocument()
    expect(phone.querySelector('b')).toBeNull()
    expect(phone.querySelector('img[src="x"]')).toBeNull()
  })

  it('shows no image from an address that is not safe', async () => {
    const banner = db().assets.get(draftOf().banner_asset_id!)!
    banner.url = 'javascript:alert(1)'
    await openBrandPage()
    expect(document.querySelector('img[src^="javascript"]')).toBeNull()
    expect(within(screen.getByRole('group', { name: /^Cover image/ })).getByText('No cover image yet')).toBeInTheDocument()
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

  it('keeps the preview behind a button on a tablet, beside the form on a laptop', async () => {
    await openBrandPage({ viewport: 768 })
    expect(screen.getByRole('button', { name: 'Show preview' })).toBeInTheDocument()
  })

  it('puts the preview beside the form at 1280 px', async () => {
    await openBrandPage({ viewport: 1280 })
    expect(preview()).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Show preview' })).toBeNull()
  })
})

describe('V-05 Brand page: discard and submit', () => {
  it('discards the draft only after asking', async () => {
    const { user } = await openBrandPage()
    await user.click(screen.getByRole('button', { name: 'Discard draft' }))
    let dialog = await screen.findByRole('dialog', { name: 'Discard your draft?' })
    expect(dialog).toHaveTextContent('Your live page stays as it is. This cannot be undone.')
    await user.click(within(dialog).getByRole('button', { name: 'Keep editing' }))
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
    expect(draftOf().about).toBe(DRAFT_STORY)
    expect(textbox('Story Changed')).toHaveValue(DRAFT_STORY)

    await user.click(screen.getByRole('button', { name: 'Discard draft' }))
    dialog = await screen.findByRole('dialog', { name: 'Discard your draft?' })
    await user.click(within(dialog).getByRole('button', { name: 'Discard draft' }))
    // The result shows in the page and takes focus; no toast (spec §8).
    const discarded = await screen.findByText('Draft discarded. Your page matches the live version again.')
    expect(discarded.closest('[role="status"]')).toBeInTheDocument()
    await waitFor(() => expect(discarded.closest('[tabindex="-1"]')).toHaveFocus())
    expect(document.querySelector('.MuiSnackbar-root')).toBeNull()
    // vendor-api keeps one draft: it now says what the live page says.
    const live = versions().find((v) => v.state === 'published')!.content
    expect(draftOf()).toMatchObject({ about: live.about, banner_asset_id: live.banner_asset_id })
    expect(textbox('Story')).toHaveValue(LIVE_STORY)
    expect(screen.queryAllByText('Changed')).toHaveLength(0)
    expect(screen.getByText('Live', { selector: '[data-status="live"]' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Discard draft' })).toBeNull()
  })

  it('saves the last edit, sends the draft for review and locks the page while it waits', async () => {
    const { user } = await openBrandPage()
    const tagline = textbox('Tagline')
    await replace(user, tagline, 'Ajrakh from Kutch.')
    // Straight to submit: the pending autosave is flushed first.
    await user.click(screen.getByRole('button', { name: 'Submit for review' }))

    expect(await screen.findByText('Sent for review. Your live page stays as it is until we approve the changes.')).toBeInTheDocument()
    const sent = versions().find((v) => v.state === 'pending_review')!
    expect(sent.content.tagline).toBe('Ajrakh from Kutch.')
    expect(screen.getByText('Pending review', { selector: '[data-status="pending"]' })).toBeInTheDocument()
    expect(tagline).toBeDisabled()
    expect(textbox(/^Story/)).toBeDisabled()
    expect(textbox('Instagram')).toBeDisabled()
    expect(screen.getByRole('button', { name: 'Replace cover image' })).toBeDisabled()
    expect(screen.queryByRole('button', { name: 'Submit for review' })).toBeNull()
    expect(screen.queryByRole('button', { name: 'Discard draft' })).toBeNull()
  }, SLOW)

  it('sends once however often Submit is pressed', async () => {
    const posts: string[] = []
    server.events.on('request:start', ({ request }) => {
      if (request.method === 'POST' && request.url.endsWith('/v1/vendor/brand-profile/submit')) posts.push(request.url)
    })
    const { user } = await openBrandPage()
    await user.dblClick(screen.getByRole('button', { name: 'Submit for review' }))
    expect(await screen.findByText('Sent for review. Your live page stays as it is until we approve the changes.')).toBeInTheDocument()
    expect(posts).toHaveLength(1)
    expect(screen.queryByRole('alert')).toBeNull()
    server.events.removeAllListeners()
  }, SLOW)

  it('opens locked while a version is in review, and lets the seller start a new draft', async () => {
    sendDraftForReview(db())
    const { user } = await openBrandPage()
    expect(screen.getByText('Your brand page is in review. You can keep editing a new draft; send it once our team has decided — usually within 24 hours.')).toBeInTheDocument()
    expect(screen.getByText('Pending review', { selector: '[data-status="pending"]' })).toBeInTheDocument()
    expect(textbox('Tagline')).toBeDisabled()
    expect(textbox('Instagram')).toBeDisabled()
    expect(screen.queryByRole('button', { name: 'Submit for review' })).toBeNull()
    expect(screen.queryByRole('button', { name: 'Discard draft' })).toBeNull()

    await user.click(screen.getByRole('button', { name: 'Edit a new draft' }))
    const tagline = textbox('Tagline')
    expect(tagline).toBeEnabled()
    await replace(user, tagline, 'Ajrakh from Kutch.')
    // The new draft saves; the version in review is not touched.
    await waitFor(() => expect(draftOf().tagline).toBe('Ajrakh from Kutch.'), AUTOSAVE_WAIT)
    expect(versions().find((v) => v.state === 'pending_review')!.content.tagline).toBe(LIVE_TAGLINE)
    expect(screen.queryByRole('button', { name: 'Submit for review' })).toBeNull()
    expect(screen.getByText('You can send this draft once our team has decided on the version in review.')).toBeInTheDocument()
  }, SLOW)

  it('quotes the reviewer when the page was sent back', async () => {
    const reason = 'The cover image has text on it. Use a photo without words.'
    sendDraftForReview(db())
    decide(db(), { brandOf: kalki().id }, { approve: false, reason })
    await openBrandPage()
    const alert = screen.getByRole('alert')
    expect(alert).toHaveTextContent('Our team sent your brand page back.')
    expect(alert).toHaveTextContent(reason)
    expect(textbox('Tagline')).toBeEnabled()
    expect(screen.getByRole('button', { name: 'Submit for review' })).toBeEnabled()
  })

  it('tells the seller, mid-edit, that the page came back, and keeps what they typed', async () => {
    sendDraftForReview(db())
    const { user, queryClient } = await openBrandPage()
    await user.click(screen.getByRole('button', { name: 'Edit a new draft' }))
    await replace(user, textbox('Tagline'), 'Ajrakh from Kutch.')
    decide(db(), { brandOf: kalki().id }, { approve: false, reason: 'Logo is cut off.' })
    await act(() => queryClient.invalidateQueries({ queryKey: ['brand-page'] }))
    const alert = await screen.findByRole('alert')
    expect(alert).toHaveTextContent('Logo is cut off.')
    expect(textbox(/^Tagline/)).toHaveValue('Ajrakh from Kutch.')
    expect(screen.getByRole('button', { name: 'Submit for review' })).toBeEnabled()
  }, SLOW)

  it('says plainly when a version is already waiting', async () => {
    db().faults.push({ path: '/v1/vendor/brand-profile/submit', method: 'POST', status: 409, code: 'review_pending', message: 'A version of the brand profile is already in review.' })
    const { user } = await openBrandPage()
    await user.click(screen.getByRole('button', { name: 'Submit for review' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('A version of your brand page is already waiting for our team. You can send this one once they have decided.')
  })

  it('sends a first brand page, naming what the brand sells from its store details', async () => {
    const vendor = addNewSeller(db())
    Object.assign(db().stores.get(vendor.id)!, { sells: 'both', city: 'Surat' })
    const { user } = await openBrandPage({ credentials: NEW_SELLER })
    expect(textbox('Brand name')).toHaveValue('Neel Threads')
    expect(textbox('Tagline')).toHaveValue('')
    expect(screen.getByText('Draft · not live yet')).toBeInTheDocument()
    expect(screen.getByText('Changes are saved as a draft. Your brand page appears in the Shazlo app once our team approves it.')).toBeInTheDocument()
    expect(screen.queryAllByText('Changed')).toHaveLength(0)
    expect(within(preview()).queryByRole('group', { name: 'Preview version' })).toBeNull()
    expect(screen.queryByRole('button', { name: 'Discard draft' })).toBeNull()

    await replace(user, textbox('Tagline'), 'Indigo, by hand.')
    await user.click(screen.getByRole('button', { name: 'Submit for review' }))
    expect(await screen.findByText('Sent for review. Your brand page goes live once we approve it.')).toBeInTheDocument()
    const sent = db().brands.get(vendor.id)!.find((v) => v.state === 'pending_review')!
    expect(sent.content).toMatchObject({ tagline: 'Indigo, by hand.', categories: ['women', 'men'] })
  }, SLOW)

  it('asks for store details first when vendor-api needs to know what the brand sells', async () => {
    addNewSeller(db())
    const { user } = await openBrandPage({ credentials: NEW_SELLER })
    await user.click(screen.getByRole('button', { name: 'Submit for review' }))
    const alert = await screen.findByRole('alert')
    expect(alert).toHaveTextContent('Tell us who you sell for in Store details first, then send your brand page.')
    expect(within(alert).getByRole('link', { name: 'Open Store details' })).toHaveAttribute('href', '/store/details/brand')
  })

  it('offers a retry when the brand page does not load', async () => {
    db().faults.push({ path: '/v1/vendor/brand-profile', method: 'GET', status: 403, code: 'forbidden', message: 'Only the store owner can edit the brand page.' })
    const { user } = await renderApp({ route: '/brand' })
    const alert = await screen.findByRole('alert', {}, { timeout: 8000 })
    expect(alert).toHaveTextContent('We could not load your brand page.')
    expect(alert).toHaveTextContent('Only the store owner can edit the brand page.')
    await user.click(within(alert).getByRole('button', { name: 'Try again' }))
    expect(await screen.findByRole('textbox', { name: 'Tagline' })).toHaveValue(LIVE_TAGLINE)
  })

  it('lets staff edit the brand page too', async () => {
    const { user } = await openBrandPage({ credentials: DEMO_STAFF })
    await replace(user, textbox('Tagline'), 'By the Kalki team.')
    await waitFor(() => expect(draftOf().tagline).toBe('By the Kalki team.'), AUTOSAVE_WAIT)
  }, SLOW)
})

describe('V-05 Brand page: logo and cover', () => {
  it('uploads a new cover with its progress, and saves it to the draft', async () => {
    const { user } = await openBrandPage()
    const before = draftOf().banner_asset_id
    await user.upload(screen.getByLabelText('Cover image file'), new File(['cover'], 'cover.png', { type: 'image/png' }))
    const cover = screen.getByRole('group', { name: /^Cover image/ })
    await waitFor(() => expect(draftOf().banner_asset_id).not.toBe(before), AUTOSAVE_WAIT)
    const asset = db().assets.get(draftOf().banner_asset_id!)!
    expect(asset).toMatchObject({ kind: 'brand_banner', status: 'ready' })
    expect(within(cover).getByRole('img', { name: 'Cover image preview' })).toHaveAttribute('src', asset.url)
  }, SLOW)

  it('shows how far an upload has got', async () => {
    server.use(http.post('*/v1/vendor/assets', () => delay(400)))
    const { user } = await openBrandPage()
    await user.upload(screen.getByLabelText('Logo file'), new File(['logo'], 'logo.png', { type: 'image/png' }))
    const logo = screen.getByRole('group', { name: /^Logo/ })
    expect(await within(logo).findByRole('progressbar', { name: 'Uploading logo' })).toBeInTheDocument()
    await waitFor(() => expect(within(logo).queryByRole('progressbar')).toBeNull(), AUTOSAVE_WAIT)
    await waitFor(() => expect(draftOf().logo_asset_id).not.toBeNull(), AUTOSAVE_WAIT)
  }, SLOW)

  it('explains why a photo was not accepted', async () => {
    await openBrandPage()
    // The file picker filters by type; a dropped or renamed file can still get through.
    const user = userEvent.setup({ applyAccept: false })
    await user.upload(screen.getByLabelText('Cover image file'), new File(['notes'], 'notes.txt', { type: 'text/plain' }))
    const cover = screen.getByRole('group', { name: /^Cover image/ })
    const problem = await within(cover).findByText(/That file type is not accepted\./)
    expect(within(cover).getByRole('button', { name: 'Replace cover image' })).toHaveAccessibleDescription(expect.stringContaining(problem.textContent!))
    // Nothing to retry: the same file would fail the same way.
    expect(within(cover).queryByRole('button', { name: 'Try again' })).toBeNull()
  })

  it('offers Try again when an upload fails on the way, and it then works', async () => {
    const { user } = await openBrandPage()
    db().faults.push({ path: '/image/upload', method: 'POST', status: 500 })
    await user.upload(screen.getByLabelText('Logo file'), new File(['logo'], 'logo.png', { type: 'image/png' }))
    const logo = screen.getByRole('group', { name: /^Logo/ })
    const retry = await within(logo).findByRole('button', { name: 'Try again' }, AUTOSAVE_WAIT)
    expect(draftOf().logo_asset_id).toBeNull()
    await user.click(retry)
    await waitFor(() => expect(draftOf().logo_asset_id).not.toBeNull(), AUTOSAVE_WAIT)
    expect(within(logo).queryByRole('button', { name: 'Try again' })).toBeNull()
  }, SLOW)
})
