import { describe, expect, it } from 'vitest'
import html from '../../index.html?raw'

// The module's own page, seen when it is opened outside Shazlo One (or in a browser tab list).
const doc = new DOMParser().parseFromString(html, 'text/html')
const shipped = Object.keys(import.meta.glob('../../public/icons/*.png')).map((path) => path.replace('../../public', ''))

describe('index.html', () => {
  it('names the page cleanly, the way Shazlo One names its pages', () => {
    expect(doc.title).toBe('Vendor admin · Shazlo One')
    // No character lost to a wrong encoding.
    expect(html).not.toContain('�')
    expect(doc.querySelector('meta[charset]')?.getAttribute('charset')).toBe('UTF-8')
  })

  it('links the 32 and 48 px favicons and the home-screen icon that ship in public/icons', () => {
    const links = [...doc.querySelectorAll('link[rel="icon"], link[rel="apple-touch-icon"]')].map((l) => ({
      rel: l.getAttribute('rel'),
      type: l.getAttribute('type'),
      sizes: l.getAttribute('sizes'),
      href: l.getAttribute('href'),
    }))
    expect(links).toEqual([
      { rel: 'icon', type: 'image/png', sizes: '32x32', href: '/icons/favicon-32.png' },
      { rel: 'icon', type: 'image/png', sizes: '48x48', href: '/icons/favicon-48.png' },
      { rel: 'apple-touch-icon', type: null, sizes: null, href: '/icons/apple-touch-icon.png' },
    ])
    for (const { href } of links) expect(shipped).toContain(href)
  })
})
