import { statusPillLabel, type PillStatus } from '@shazlo/ui'
import { describe, expect, it } from 'vitest'
import { overviewCopy } from './overview'
import { productsCopy } from './products'
import { reviewCopy } from './review'
import { shellCopy } from './shell'
import { pillLabel, productStatusWords, statusWords } from './status'

// #267: a seller sees one word for each status, on every screen. The admin keeps its own words,
// which are @shazlo/ui's default pill labels, so none of these may appear as a seller label.
const ADMIN_ONLY = ['Pending review', 'Sent back', 'Edit in review', 'Needs your changes', 'Waiting', 'Waiting for review']
const isAdminOnly = (text: string) => ADMIN_ONLY.some((word) => word.toLowerCase() === text.trim().toLowerCase())
// Never right anywhere in seller copy, not even inside a sentence or a count ("5 waiting").
const ADMIN_PHRASE = /needs your changes|edit in review|pending review|waiting for review|\b\d+ waiting\b/i

describe('the seller status words', () => {
  it('name each product status once', () => {
    expect(productStatusWords).toEqual({ draft: 'Draft', pending_review: 'In review', approved: 'Live', rejected: 'Needs changes', archived: 'Archived' })
  })

  it('give every pill a seller word', () => {
    expect(pillLabel).toEqual({
      live: 'Live',
      pending: 'In review',
      sentBack: 'Needs changes',
      editInReview: 'Changes in review',
      draft: 'Draft',
      publishing: 'Publishing',
      archived: 'Archived',
      suspended: 'Suspended',
    } satisfies Record<PillStatus, string>)
  })

  it('cover every pill the shared package knows, so a new one cannot show the admin word', () => {
    expect(Object.keys(pillLabel).sort()).toEqual(Object.keys(statusPillLabel).sort())
  })

  it('call a product the same in a pill and in plain text', () => {
    expect(pillLabel.live).toBe(productStatusWords.approved)
    expect(pillLabel.pending).toBe(productStatusWords.pending_review)
    expect(pillLabel.sentBack).toBe(productStatusWords.rejected)
    expect(pillLabel.draft).toBe(productStatusWords.draft)
    expect(pillLabel.archived).toBe(productStatusWords.archived)
    expect(pillLabel.editInReview).toBe(statusWords.changesInReview)
  })

  it('never use a word only the admin uses', () => {
    const words = [...Object.values(pillLabel), ...Object.values(productStatusWords), ...Object.values(statusWords)]
    expect(words.filter(isAdminOnly)).toEqual([])
  })
})

describe('every place that names a status uses them', () => {
  it('Products: tabs, list and editor', () => {
    const tab = Object.fromEntries(productsCopy.tabs.map((t) => [t.key, t.label]))
    expect(tab.approved).toBe(statusWords.live)
    expect(tab.pending_review).toBe(statusWords.inReview)
    expect(tab.rejected).toBe(statusWords.needsChanges)
    expect(tab.draft).toBe(statusWords.drafts)
    expect(tab.archived).toBe(statusWords.archived)
    expect(productsCopy.statuses).toEqual(productStatusWords)
    expect(productsCopy.changesInReview).toBe(statusWords.changesInReview)
  })

  it('Overview: the figures on wide screens, the section and counts on phones', () => {
    expect(overviewCopy.stats.inReview.label).toBe(statusWords.inReview)
    expect(overviewCopy.stats.needsChanges.label).toBe(statusWords.needsChanges)
    expect(overviewCopy.stats.drafts.label).toBe(statusWords.drafts)
    expect(overviewCopy.home.changes.title).toBe(statusWords.needsChanges)
    expect(overviewCopy.home.counts.rows).toEqual({ approved: statusWords.live, pending_review: statusWords.inReview, draft: statusWords.drafts })
  })

  it('Review status: the tabs and the queue', () => {
    expect(reviewCopy.tabs.waiting).toBe(statusWords.inReview)
    expect(reviewCopy.tabs.rejected).toBe(statusWords.needsChanges)
    expect(reviewCopy.tabs.approved).toBe(statusWords.live)
    expect(reviewCopy.waiting.title).toBe(statusWords.inReview)
  })

  it('the count beside Review status in the sidebar', () => {
    expect(shellCopy.reviewCount(0)).toBe('0 in review')
    expect(shellCopy.reviewCount(5)).toBe('5 in review')
  })
})

// A label is a whole string. Sentences may still say what the team did ("Sent back today,
// 11:40", "… was sent back"), and the product history lists events, so its "Sent back" stays.
const EVENTS = new Set(['productEditor.productEditorCopy.history.events.rejected'])

function strings(value: unknown, path: string, out: [string, string][]) {
  if (typeof value === 'string') out.push([path, value])
  else if (Array.isArray(value)) value.forEach((v, i) => strings(v, `${path}.${i}`, out))
  else if (value && typeof value === 'object') for (const [k, v] of Object.entries(value)) strings(v, `${path}.${k}`, out)
}

describe('seller copy', () => {
  const modules = import.meta.glob<Record<string, unknown>>(['./*.ts', '!./*.test.ts'], { eager: true })

  it('is all checked here', () => {
    expect(Object.keys(modules).length).toBeGreaterThanOrEqual(13)
    expect(Object.keys(modules)).toContain('./status.ts')
  })

  it('never uses an admin-only status word as a label', () => {
    const found: [string, string][] = []
    for (const [file, module] of Object.entries(modules)) strings(module, file.replace(/^\.\/|\.ts$/g, ''), found)
    expect(found.length).toBeGreaterThan(500)
    expect(found.filter(([path, text]) => isAdminOnly(text) && !EVENTS.has(path))).toEqual([])
  })

  it('never says an admin-only phrase, even in a sentence built by a copy function', () => {
    // Copy written as functions is called with a few typical arguments; ones that need others are skipped.
    const ARGS: unknown[][] = [[1], [2], [0], ['Ajrakh Block-Print Kurta'], ['today, 11:40'], [3, 'cover image, story'], [2, 5]]
    const texts: [string, string][] = []
    const visit = (value: unknown, path: string) => {
      if (typeof value === 'function') {
        for (const args of ARGS) {
          try {
            const out: unknown = value(...args)
            if (typeof out === 'string') texts.push([`${path}(${args.join(', ')})`, out])
          } catch {
            // Needs other arguments.
          }
        }
      } else if (typeof value === 'string') texts.push([path, value])
      else if (Array.isArray(value)) value.forEach((v, i) => visit(v, `${path}.${i}`))
      else if (value && typeof value === 'object') for (const [k, v] of Object.entries(value)) visit(v, `${path}.${k}`)
    }
    for (const [file, module] of Object.entries(modules)) visit(module, file.replace(/^\.\/|\.ts$/g, ''))
    expect(texts.filter(([path]) => path.includes('(')).length).toBeGreaterThan(100)
    expect(texts.filter(([, text]) => ADMIN_PHRASE.test(text))).toEqual([])
    // The two sentences the bell and the sidebar read out.
    expect(shellCopy.notificationsNeedChanges(1)).toBe('Notifications, 1 needs changes')
    expect(shellCopy.notificationsNeedChanges(2)).toBe('Notifications, 2 need changes')
  })

  it('keeps the history event it allows', () => {
    // If this key moves, update EVENTS rather than letting the check go quiet.
    const found: [string, string][] = []
    for (const [file, module] of Object.entries(modules)) strings(module, file.replace(/^\.\/|\.ts$/g, ''), found)
    for (const path of EVENTS) expect(found.map(([p]) => p)).toContain(path)
  })
})
