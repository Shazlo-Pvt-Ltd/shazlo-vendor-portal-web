import { describe, expect, it } from 'vitest'
import { safeNext } from './returnTo'

// Sign-in links carry where to go next (`/sign-in?next=...`). Only places inside the shell are kept.
describe('safeNext', () => {
  it.each(['/', '/?tab=1#top', '/admins', '/admins?status=all&q=sneha', '/catalogue', '/catalogue/', '/catalogue/review/product/p1?tab=2#history', '/campaigns/drafts'])('keeps %s', (path) => {
    expect(safeNext(path)).toBe(path)
  })

  it('keeps the path the router would get once "." and ".." segments are resolved', () => {
    expect(safeNext('/catalogue/queue/../sellers')).toBe('/catalogue/sellers')
    expect(safeNext('/catalogue/../admins')).toBe('/admins')
  })

  it.each([
    ['nothing', null],
    ['an empty value', ''],
    ['another site', 'https://evil.example/'],
    ['a protocol-relative address', '//evil.example/'],
    ['a backslash after the slash', '/\\evil.example'],
    ['a backslash later on', '/catalogue/..\\evil'],
    ['a backslash and a slash', '/\\/evil.example'],
    ['an encoded backslash', '/%5Cevil.example'],
    ['a scheme', 'javascript:alert(1)'],
    ['a data URL', 'data:text/html,hi'],
    ['a tab', '/\t/evil.example'],
    ['a line feed', '/\n/evil.example'],
    ['a relative path', 'admins'],
    ['the sign-in screen (not a destination)', '/sign-in'],
    ['the change-password screen', '/change-password'],
    ['a path the shell does not have', '/nowhere'],
    ['a look-alike of a module', '/catalogueX/queue'],
    ['a look-alike of a shell page', '/admins-old'],
    ['a climb out to a page the shell does not have', '/catalogue/../../nowhere'],
    ['something absurdly long', `/${'a'.repeat(2500)}`],
  ])('falls back to Home for %s', (_name, value) => {
    expect(safeNext(value)).toBe('/')
  })
})
