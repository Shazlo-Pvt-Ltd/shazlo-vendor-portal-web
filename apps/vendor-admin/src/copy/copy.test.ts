import { describe, expect, it } from 'vitest'
import { dashboardCopy } from './dashboard'
import { publishingCopy } from './publishing'
import { queueCopy } from './queue'
import { reviewCopy } from './review'
import { commissionCopy, rateErrors, sellsLabel, vendorActionsCopy, vendorDetailCopy, vendorsCopy, vendorTabs } from './vendors'

// The house rule: no full stop at the end of a heading, title, label, button, tab, chip or menu
// item. Sentences (body text, hints, errors, toasts, banner messages) keep theirs.

const COPY = { dashboardCopy, queueCopy, publishingCopy, reviewCopy, vendorsCopy, vendorActionsCopy, vendorDetailCopy, commissionCopy, rateErrors, sellsLabel, vendorTabs }

// The strings that are sentences, by where they sit in the copy.
const SENTENCES = [
  /\.(body|intro|hint|subtitle|text|message|banner)$/,
  /\.(errors|toast)\./,
  /^rateErrors\./,
  /\.(empty|none|notFoundBody|nothingToExport|copyFailed|retriedAll|conflict|alreadyBody|noReason|notLive|noProposal|priceRuleText|proposedHint|noProposalHint|noteHint|noteLong|reasonHint|reasonShort|tryOnHint|shows|showsOnly|aboveMrp|forType|forTypePhoto|missingProduct|missingTryOn|blockedCommission|blockedAgreement|blockedFields)$/,
  /^reviewCopy\.decided\.(approved|sentBack)$/,
  /^vendorDetailCopy\.commission\.(notSet|proposed|now|noneYet|sentBack|theyProposed|approveBanner)$/,
  /^vendorDetailCopy\.brand\.(live|notLive|waiting|nothingWaiting|error)$/,
]

// Copy functions take words, counts or lists; try each until one gives a string.
const SAMPLE_ARGS: unknown[][] = [
  ['Kalki Studio', 'Priya Mehta', 'Today, 10:30'],
  [2, 3, 4],
  [['Front', 'Back']],
]

function sample(fn: (...args: unknown[]) => unknown): string | null {
  for (const args of SAMPLE_ARGS) {
    try {
      const out = fn(...args)
      if (typeof out === 'string') return out
    } catch {
      // The wrong kind of argument; try the next.
    }
  }
  return null
}

type Leaf = { path: string; text: string }

function leaves(value: unknown, path: string, out: Leaf[] = []): Leaf[] {
  if (typeof value === 'string') out.push({ path, text: value })
  else if (typeof value === 'function') {
    const text = sample(value as (...args: unknown[]) => unknown)
    if (text !== null) out.push({ path, text })
  } else if (Array.isArray(value)) value.forEach((v, i) => leaves(v, `${path}[${i}]`, out))
  else if (value && typeof value === 'object') for (const [key, v] of Object.entries(value)) leaves(v, `${path}.${key}`, out)
  return out
}

const all = Object.entries(COPY).flatMap(([name, value]) => leaves(value, name))
const isSentence = (path: string) => SENTENCES.some((re) => re.test(path))

describe('Admin copy', () => {
  it('walks every string, including the ones built by functions', () => {
    expect(all.length).toBeGreaterThan(300)
    expect(all.find((l) => l.path === 'reviewCopy.decided.alreadyApproved')?.text).toMatch(/^Already approved by Kalki Studio · Priya Mehta/)
    // A function that takes a list.
    expect(all.find((l) => l.path === 'reviewCopy.product.photos.missingProduct')?.text).toMatch(/^Missing front, back photos\./)
    expect(all.find((l) => l.path === 'vendorTabs[3].label')?.text).toBe('Rate to review')
  })

  it('ends no heading, title, label, button, tab, chip or menu item with a full stop', () => {
    const stops = all.filter((l) => !isSentence(l.path) && /\.$/.test(l.text) && !/…$/.test(l.text))
    expect(stops.map((l) => `${l.path}: ${l.text}`)).toEqual([])
  })

  it('keeps the full stop on sentences', () => {
    const sentence = (path: string) => all.find((l) => l.path === path)!.text
    expect(sentence('queueCopy.rates.text')).toMatch(/ proposed a commission rate\.$/)
    expect(queueCopy.rates.text(2)).toBe('2 brands proposed a commission rate.')
    expect(sentence('reviewCopy.sendBack.intro')).toMatch(/\.$/)
    expect(sentence('vendorDetailCopy.commission.proposed')).toBe('Kalki Studio proposed Priya Mehta.')
  })

  it('names the module’s load error without a full stop, like the other load errors', () => {
    expect(reviewCopy.loadError).toBe('We could not load this submission')
    expect(reviewCopy.decided.alreadySentBack('Rahul Desai', 'Today, 13:10')).toBe('Already sent back by Rahul Desai · Today, 13:10')
  })
})
