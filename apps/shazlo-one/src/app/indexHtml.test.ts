import { describe, expect, it } from 'vitest'
import html from '../../index.html?raw'

// What is in public/icons, so a link to a missing file fails here rather than as a 404 in the tab.
const icons = Object.keys(import.meta.glob('../../public/icons/*.png'))
const page = new DOMParser().parseFromString(html, 'text/html')

describe('index.html', () => {
  it('links the 32 px and 48 px favicons and the Apple touch icon', () => {
    const links = Array.from(page.querySelectorAll('link[rel="icon"], link[rel="apple-touch-icon"]'), (l) => [l.getAttribute('rel'), l.getAttribute('type'), l.getAttribute('sizes'), l.getAttribute('href')])
    expect(links).toEqual([
      ['icon', 'image/png', '32x32', '/icons/favicon-32.png'],
      ['icon', 'image/png', '48x48', '/icons/favicon-48.png'],
      ['apple-touch-icon', null, null, '/icons/apple-touch-icon.png'],
    ])
    for (const [, , , href] of links) expect(icons).toContain(`../../public${href}`)
  })
})
