import { cleanup, fireEvent, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import { mockApi } from '../../api/mock'
import { renderRoute } from '../../test/render'

// The suite shares a busy machine with other dev servers; give async UI generous time.
const wait = { timeout: 10_000 }

describe('V-05 Brand page editor', () => {
  // Leaving the editor saves any unsaved edit; let that save land before the next test resets the mock.
  afterEach(async () => {
    cleanup()
    await new Promise(r => setTimeout(r, 50))
  })

  it('tags draft fields that differ from the live page, including new edits', async () => {
    renderRoute('/brand')
    const tagline = await screen.findByLabelText('Tagline', undefined, wait)
    // The fixture draft changes the cover image and the story.
    expect(screen.getAllByText('Changed')).toHaveLength(2)
    expect(screen.getByText('Draft · 2 changes')).toBeTruthy()

    fireEvent.change(tagline, { target: { value: 'Ajrakh from Kutch, dyed by hand.' } })
    expect(screen.getAllByText('Changed')).toHaveLength(3)
    expect(screen.getByText('Draft · 3 changes')).toBeTruthy()
    expect(screen.getByText('32 / 60')).toBeTruthy()

    // Putting the live value back removes the tag again.
    fireEvent.change(tagline, { target: { value: 'Hand block-printed, naturally dyed.' } })
    expect(screen.getAllByText('Changed')).toHaveLength(2)
  }, 30_000)

  it('stops a submit with a missing tagline and moves focus to it', async () => {
    renderRoute('/brand')
    const tagline = await screen.findByLabelText('Tagline', undefined, wait)
    fireEvent.change(tagline, { target: { value: '' } })
    fireEvent.click(screen.getByRole('button', { name: 'Submit for review' }))
    expect(await screen.findByText('Add a tagline. Shoppers see it under your brand name.', undefined, wait)).toBeTruthy()
    await waitFor(() => expect(document.activeElement).toBe(tagline), wait)
    expect(tagline.getAttribute('aria-invalid')).toBe('true')
  }, 30_000)

  it('submits the draft for review, which locks it as pending', async () => {
    renderRoute('/brand')
    const story = await screen.findByLabelText('Story', undefined, wait)
    fireEvent.change(story, { target: { value: 'Small batches from Kutch, printed by hand.' } })
    fireEvent.click(screen.getByRole('button', { name: 'Submit for review' }))

    expect(await screen.findByText('Your draft is with the Shazlo review team', undefined, wait)).toBeTruthy()
    expect(screen.getAllByText('Pending review').length).toBeGreaterThan(0)
    // The whole form sits in a disabled fieldset while the draft is in review.
    expect(screen.getByLabelText('Story').closest('fieldset')?.disabled).toBe(true)
    await waitFor(() => expect((screen.getByRole('button', { name: 'Submit for review' }) as HTMLButtonElement).disabled).toBe(true), wait)

    const profile = await mockApi.getBrandProfile()
    expect(profile.status).toBe('pending_review')
    expect(profile.draft.story).toBe('Small batches from Kutch, printed by hand.')
    const waiting = (await mockApi.listSubmissions()).filter(s => !s.decision)
    expect(waiting.some(s => s.subject.kind === 'brand_page')).toBe(true)
  }, 30_000)

  it('asks before discarding the draft, then shows the live version', async () => {
    renderRoute('/brand')
    await screen.findByLabelText('Tagline', undefined, wait)
    fireEvent.click(screen.getByRole('button', { name: 'Discard draft' }))
    expect(await screen.findByText('Discard your draft?', undefined, wait)).toBeTruthy()
    const confirm = screen.getAllByRole('button', { name: 'Discard draft' }).at(-1)
    if (!confirm) throw new Error('no confirm button')
    fireEvent.click(confirm)
    await waitFor(() => expect(screen.queryAllByText('Changed')).toHaveLength(0), wait)
    expect(screen.getByText('Live · no changes')).toBeTruthy()
    expect((screen.getByLabelText('Story') as HTMLTextAreaElement).value).toBe('Ajrakh block prints from Kutch, dyed by hand with indigo and madder.')
  }, 30_000)
})
