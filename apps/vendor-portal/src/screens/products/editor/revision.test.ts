import { describe, expect, it } from 'vitest'
import type { Schemas } from '../../../api/model'
import type { EditorValues } from './form'
import { revisionChanges } from './revision'

// Main's revision panel as a Build 2 side card: what shoppers see now, beside the seller's changes.

const live: Schemas['ProductVersion'] = {
  version: 1,
  title: 'Handloom Cotton Shirt',
  description: 'Relaxed shirt in handloom cotton.',
  category: 'Shirts',
  gender: 'Unisex',
  material: 'Handloom cotton',
  main_colour: 'Rust',
  other_colours: [],
  price_paise: 129900,
  mrp_paise: 149900,
  images: [
    { id: 'a', url: 'https://res.cloudinary.com/x/a.jpg', angle: 'front' },
    { id: 'b', url: 'https://res.cloudinary.com/x/b.jpg', angle: 'back' },
  ],
  variants: [
    { size: 'M', sku: 'C-M', stock: 4 },
    { size: 'L', sku: 'C-L', stock: 6 },
  ],
}

const same: EditorValues = {
  title: 'Handloom Cotton Shirt',
  gender: 'Unisex',
  category: 'Shirts',
  mainColour: 'Rust',
  otherColours: [],
  material: 'Handloom cotton',
  description: 'Relaxed shirt in handloom cotton.',
  sizes: [
    { size: 'M', stock: '4' },
    { size: 'L', stock: '6' },
  ],
  price: '1,299',
  mrp: '1,499',
}

describe('revisionChanges', () => {
  it('finds nothing when the form matches what is live', () => {
    expect(revisionChanges(live, same, live.images)).toEqual([])
    // Typing the same price another way is no change.
    expect(revisionChanges(live, { ...same, price: '₹1299.00' }, live.images)).toEqual([])
  })

  it('lists each change in plain words, live value first', () => {
    const changes = revisionChanges(live, { ...same, price: '1,199', title: '  Handloom Shirt — Rust ', sizes: [{ size: 'M', stock: '0' }, { size: 'L', stock: '6' }] }, live.images)
    expect(changes).toEqual([
      { field: 'title', label: 'Name', live: 'Handloom Cotton Shirt', yours: 'Handloom Shirt — Rust' },
      { field: 'sizes', label: 'Sizes and stock', live: 'M 4 · L 6', yours: 'M 0 · L 6' },
      { field: 'price', label: 'Selling price', live: '₹1,299', yours: '₹1,199' },
    ])
  })

  it('says when something is not there at all', () => {
    const changes = revisionChanges(live, { ...same, mrp: '', otherColours: ['Black'] }, live.images)
    expect(changes).toEqual([
      { field: 'colours', label: 'Other colours', live: 'None', yours: 'Black', colours: { live: [], yours: ['Black'] } },
      { field: 'mrp', label: 'MRP', live: '₹1,499', yours: 'None' },
    ])
  })

  it('compares colours as they will be saved, and keeps them for their swatches', () => {
    // The same colour typed another way is no change.
    expect(revisionChanges(live, { ...same, mainColour: ' rust ' }, live.images)).toEqual([])
    expect(revisionChanges(live, { ...same, mainColour: '#b7410e', otherColours: ['Kalamkari indigo', ''] }, live.images)).toEqual([
      { field: 'colour', label: 'Main colour', live: 'Rust', yours: '#B7410E', colours: { live: ['Rust'], yours: ['#B7410E'] } },
      { field: 'colours', label: 'Other colours', live: 'None', yours: 'Kalamkari indigo', colours: { live: [], yours: ['Kalamkari indigo'] } },
    ])
    // A hex code that is not one is not what will be saved: the live colour stays.
    expect(revisionChanges(live, { ...same, mainColour: '#12' }, live.images)).toEqual([])
  })

  it('counts photos, and notices a photo swapped for another', () => {
    expect(revisionChanges(live, same, [live.images[0]!])).toEqual([{ field: 'photos', label: 'Photos', live: '2 photos', yours: '1 photo' }])
    const swapped = [live.images[0]!, { id: 'c', url: 'https://res.cloudinary.com/x/c.jpg', angle: 'back' as const }]
    expect(revisionChanges(live, same, swapped)).toEqual([{ field: 'photos', label: 'Photos', live: '2 photos', yours: '2 photos, changed' }])
  })

  it('shortens a long description', () => {
    const long = 'Relaxed shirt in handloom cotton, woven in Kutch by a family of weavers, washed soft, with a camp collar and coconut buttons.'
    const [change] = revisionChanges(live, { ...same, description: long }, live.images)
    expect(change!.label).toBe('Description')
    expect(change!.yours.length).toBeLessThanOrEqual(61)
    expect(change!.yours.endsWith('…')).toBe(true)
  })

  it('never calls anything a SKU', () => {
    const all = revisionChanges(live, { ...same, title: 'x', sizes: [], price: '9' }, []).flatMap((c) => [c.label, c.live, c.yours]).join(' ')
    expect(all).not.toMatch(/SKU/i)
  })
})
