import type { BrandProfileFields } from '../../api/types'

export const TAGLINE_MAX = 60
export const STORY_MAX = 600

export type BrandErrors = Partial<Record<keyof BrandProfileFields, string>>

type Option = { value: string; label: string }
/** Keeps a stored value selectable even if it is no longer one of the standard options. */
const withCurrent = (options: Option[], current: string) =>
  current && !options.some(o => o.value === current) ? [{ value: current, label: current }, ...options] : options

const CITIES = [
  'Ahmedabad, Gujarat', 'Bengaluru, Karnataka', 'Bhuj, Gujarat', 'Chennai, Tamil Nadu', 'Delhi', 'Hyderabad, Telangana', 'Jaipur, Rajasthan',
  'Kolkata, West Bengal', 'Lucknow, Uttar Pradesh', 'Mumbai, Maharashtra', 'Pune, Maharashtra', 'Surat, Gujarat', 'Varanasi, Uttar Pradesh',
]
export const cityOptions = (current: string) => withCurrent(CITIES.map(c => ({ value: c, label: c })), current)

/** Return policies the app shows, with the short form used on the brand page ("7-day returns"). */
export const RETURN_POLICIES: Array<Option & { short: string }> = [
  { value: '7-day returns, unworn with tags', label: '7-day returns, unworn with tags', short: '7-day returns' },
  { value: '14-day returns, unworn with tags', label: '14-day returns, unworn with tags', short: '14-day returns' },
  { value: '7-day exchange only', label: '7-day exchange only', short: 'Exchange only' },
  { value: 'No returns', label: 'No returns (made to order)', short: 'No returns' },
]
export const returnOptions = (current: string) => withCurrent(RETURN_POLICIES, current)
export const returnShort = (value: string) => RETURN_POLICIES.find(r => r.value === value)?.short ?? value

const DISPATCH = ['1–2 days', '2–3 days', '4–7 days', '1–2 weeks']
export const dispatchOptions = (current: string) => withCurrent(DISPATCH.map(d => ({ value: d, label: `Ships in ${d}` })), current)

const INSTAGRAM = /^@?[A-Za-z0-9._]{1,30}$/
const WEBSITE = /^(https?:\/\/)?([\w-]+\.)+[a-z]{2,}(\/\S*)?$/i

/** V-05 checks before a draft goes to the review team. Images and selects always hold a valid value. */
export function validateBrand(f: BrandProfileFields): BrandErrors {
  const e: BrandErrors = {}
  if (!f.tagline.trim()) e.tagline = 'Add a tagline. Shoppers see it under your brand name.'
  else if (f.tagline.length > TAGLINE_MAX) e.tagline = `Keep the tagline to ${TAGLINE_MAX} characters.`
  if (!f.story.trim()) e.story = 'Tell shoppers your story. A few lines about who makes your pieces is enough.'
  else if (f.story.length > STORY_MAX) e.story = `Keep the story to ${STORY_MAX} characters.`
  if (!f.instagram.trim()) e.instagram = 'Add your Instagram handle, like @kalki.studio.'
  else if (!INSTAGRAM.test(f.instagram.trim())) e.instagram = 'Use your handle, like @kalki.studio, not a link.'
  if (f.website.trim() && !WEBSITE.test(f.website.trim())) e.website = 'Enter a web address like kalkistudio.in, or leave it empty.'
  return e
}

const fieldNames: Partial<Record<keyof BrandProfileFields, string>> = {
  logoUrl: 'logo', coverUrl: 'cover image', tagline: 'tagline', story: 'story', city: 'location', instagram: 'Instagram',
  website: 'website', shipsIn: 'dispatch time', returnPolicy: 'return policy', categories: 'categories', brandName: 'brand name',
}
/** "cover image, story", in the order the editor shows the fields. */
export function changedList(fields: Array<keyof BrandProfileFields>) {
  const order: Array<keyof BrandProfileFields> = ['logoUrl', 'coverUrl', 'brandName', 'city', 'tagline', 'story', 'returnPolicy', 'shipsIn', 'instagram', 'website', 'categories']
  return order.filter(f => fields.includes(f)).map(f => fieldNames[f] ?? f).join(', ')
}
