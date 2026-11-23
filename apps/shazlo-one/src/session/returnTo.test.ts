import { describe, expect, it } from 'vitest'
import { safeReturnTo } from './returnTo'

describe('safeReturnTo', () => {
  it('keeps a path to a signed-in shell screen, with its query and hash', () => {
    expect(safeReturnTo('/')).toBe('/')
    expect(safeReturnTo('/?tab=1#top')).toBe('/?tab=1#top')
  })

  it.each(['/m/vendor-admin', '/m/vendor-admin/', '/m/vendor-admin/orders/9?tab=2#top', '/admins'])(
    'keeps %s: a module and the rest of its path belong to the shell and the module',
    (path) => {
      expect(safeReturnTo(path)).toBe(path)
    },
  )

  it.each(['/m', '/m/', '/mx/vendor-admin', '/admins/extra', '/m/vendor-admin/..\\evil'])(
    'does not accept %s as a place inside the shell',
    (path) => {
      expect(safeReturnTo(path)).toBe('/')
    },
  )

  it.each([
    ['nothing', null],
    ['an empty value', ''],
    ['another site', 'https://evil.example/'],
    ['a protocol-relative address', '//evil.example/'],
    ['a scheme', 'javascript:alert(1)'],
    ['a backslash trick', '/\\evil.example'],
    ['a control character', '/\n/evil.example'],
    ['a relative path', 'login'],
    ['the login screen (it is not a destination)', '/login'],
    ['the change-password screen', '/change-password'],
    ['a path the shell does not have', '/nowhere'],
    ['something absurdly long', `/${'a'.repeat(2500)}`],
  ])('falls back to / for %s', (_name, value) => {
    expect(safeReturnTo(value)).toBe('/')
  })
})
