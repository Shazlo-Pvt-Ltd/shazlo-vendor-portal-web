import { describe, expect, it } from 'vitest'
import { brandSchema, changedFields, emptyProfile, forSaving, instagramHref, normaliseInstagram, toValues, websiteHref, type BrandValues, type Profile } from './schema'

const live: Profile = {
  ...emptyProfile('Kalki Studio'),
  based_in: 'Ahmedabad, Gujarat',
  story: 'We work with Ajrakh printers.',
  instagram: '@kalki.studio',
  website: 'https://kalkistudio.in',
}
const values = (over: Partial<BrandValues> = {}): BrandValues => ({ ...toValues(live), ...over })
const problems = (v: BrandValues) => {
  const result = brandSchema.safeParse(v)
  return result.success ? {} : Object.fromEntries(result.error.issues.map((i) => [String(i.path[0]), i.message]))
}

// Main's rules (features/brand/rules.ts) that still apply to Build 2's form.
describe('the Instagram name', () => {
  it.each([
    ['@kalki.studio', 'kalki.studio'],
    ['kalki_studio', 'kalki_studio'],
    ['  @brand  ', 'brand'],
    ['instagram.com/kalki.studio/', 'kalki.studio'],
    ['https://www.instagram.com/kalki.studio?igsh=abc', 'kalki.studio'],
    ['http://instagram.com/Brand_1#top', 'Brand_1'],
    ['', ''],
  ])('reads %j as %j', (typed, handle) => {
    expect(normaliseInstagram(typed)).toBe(handle)
  })

  it.each(['two words', 'a'.repeat(31), 'https://example.com/brand', 'bad!name', '@@x', 'javascript:alert(1)'])('refuses %j', (typed) => {
    expect(normaliseInstagram(typed)).toBeUndefined()
    expect(problems(values({ instagram: typed })).instagram).toBe('Use your Instagram name, like @kalki.studio, or the address of your profile.')
  })

  it('is saved as @handle, whatever form it was typed in', () => {
    expect(forSaving(values({ instagram: 'https://instagram.com/kalki.handloom/' })).instagram).toBe('@kalki.handloom')
    expect(forSaving(values({ instagram: '' })).instagram).toBe('')
    expect(instagramHref('@kalki.studio')).toBe('https://www.instagram.com/kalki.studio')
    expect(instagramHref('not a handle!')).toBeUndefined()
  })

  it('is not a change when only the way it is written differs', () => {
    expect(changedFields(values({ instagram: 'kalki.studio' }), live).has('instagram')).toBe(false)
    expect(changedFields(values({ instagram: 'instagram.com/kalki.studio' }), live).has('instagram')).toBe(false)
    expect(changedFields(values({ instagram: '@kalki.handloom' }), live).has('instagram')).toBe(true)
  })
})

describe('the website', () => {
  it('takes a bare address and links it as https', () => {
    expect(websiteHref('kalkistudio.in')).toBe('https://kalkistudio.in/')
    expect(websiteHref('http://kalkistudio.in/shop')).toBe('https://kalkistudio.in/shop')
    expect(websiteHref('https://kalkistudio.in')).toBe('https://kalkistudio.in/')
    expect(websiteHref('')).toBeUndefined()
  })

  it.each(['javascript:alert(1)', 'data:text/html,<b>x</b>', 'kalki studio', 'https://', 'ftp://kalkistudio.in'])('refuses %j and never links it', (typed) => {
    expect(problems(values({ website: typed })).website).toBeTruthy()
    expect(websiteHref(typed)).toBeUndefined()
  })
})

describe("vendor-api's limits", () => {
  it('stops at 120 characters for the place and 500 for the website, in any script', () => {
    expect(problems(values({ based_in: 'अ'.repeat(120) })).based_in).toBeUndefined()
    expect(problems(values({ based_in: 'अ'.repeat(121) })).based_in).toBe('Keep this to 120 characters.')
    // Counted as saved: a bare address gains https://.
    expect(problems(values({ website: `kalkistudio.in/${'a'.repeat(477)}` })).website).toBeUndefined()
    expect(problems(values({ website: `kalkistudio.in/${'a'.repeat(478)}` })).website).toBe('Keep the web address to 500 characters.')
  })

  it("keeps Build 2's shorter limit for the story", () => {
    expect(problems(values({ story: 'x'.repeat(600) })).story).toBeUndefined()
    expect(problems(values({ story: 'x'.repeat(601) })).story).toBe('Keep the story to 600 characters.')
  })
})

describe('what is live and what is your draft', () => {
  it('names nothing changed before a page has gone live', () => {
    expect(changedFields(values({ story: 'New' }), null).size).toBe(0)
  })

  it('names each field that differs from the live page', () => {
    expect([...changedFields(values({ story: 'New', cover_url: 'https://res.cloudinary.com/x.jpg' }), live)]).toEqual(['cover_url', 'story'])
  })
})

describe('the tagline', () => {
  it('is not part of the brand page any more', () => {
    expect(toValues(live)).not.toHaveProperty('tagline')
    expect(emptyProfile('Kalki Studio')).not.toHaveProperty('tagline')
    expect(Object.keys(brandSchema.shape)).not.toContain('tagline')
  })

  it('is dropped from what the form checks, whatever an old value says', () => {
    const parsed = brandSchema.parse({ ...values(), tagline: 'x'.repeat(200) })
    expect(parsed).not.toHaveProperty('tagline')
  })
})
