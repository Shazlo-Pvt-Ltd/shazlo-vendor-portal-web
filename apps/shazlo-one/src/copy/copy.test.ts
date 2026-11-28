import { describe, expect, it } from 'vitest'
import { adminsCopy } from './admins'
import { authCopy } from './auth'
import { homeCopy } from './home'
import { shellCopy } from './shell'

// Keys whose text is one or more full sentences (body text, hints, explanations): these keep their
// full stop. Everything else is a heading, title, label, tile label, button, tab or menu item.
const SENTENCES = new Set([
  'subtitle',
  'forgotHelp',
  'expired',
  'signedOut',
  'body',
  'emptyBody',
  'intro',
  'passwordHint',
  'sentBody',
  'doneBody',
  'copyFailed',
  'selfDeactivate',
  'selfReset',
  'selfSuper',
  'failedBody',
  'unavailableBody',
  'versionBody',
  'forbiddenBody',
  // A module's manifest or summary could not be read.
  'unreachable',
  'invalid',
])

type Leaf = { path: string; key: string; text: string }

// Every string in a copy object, with functions called on sample values.
function leaves(value: unknown, path: string[]): Leaf[] {
  if (typeof value === 'function') return leaves((value as (...args: string[]) => unknown)('1', '2', '3'), path)
  if (typeof value === 'string') return [{ path: path.join('.'), key: path.filter((p) => !/^\d+$/.test(p)).at(-1) ?? '', text: value }]
  if (value && typeof value === 'object') return Object.entries(value).flatMap(([k, v]) => leaves(v, [...path, k]))
  return []
}

const all = [...leaves(authCopy, ['auth']), ...leaves(homeCopy, ['home']), ...leaves(shellCopy, ['shell']), ...leaves(adminsCopy, ['admins'])]

describe('copy', () => {
  it('reads every copy file', () => {
    expect(all.length).toBeGreaterThan(100)
  })

  it('ends no heading, title, label, button or menu item with a full stop', () => {
    const offenders = all.filter((l) => l.text.endsWith('.') && !SENTENCES.has(l.key) && !l.path.includes('.errors.')).map((l) => `${l.path}: ${l.text}`)
    expect(offenders).toEqual([])
  })

  it('heads the sign-in panel without a full stop and drops the "internal tool" line', () => {
    expect(authCopy.signIn.pitch).toBe('One place to run Shazlo')
    expect(all.some((l) => /internal tool|access is logged/i.test(l.text))).toBe(false)
  })
})
