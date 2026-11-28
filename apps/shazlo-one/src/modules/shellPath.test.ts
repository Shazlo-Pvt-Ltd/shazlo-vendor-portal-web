import { describe, expect, it } from 'vitest'
import { moduleBasePath, modulePathFrom, shellUrlFor } from './shellPath'

describe('the shell address for a module path', () => {
  it.each([
    ['/orders', '/m/vendor-admin/orders'],
    ['/orders/42?tab=2', '/m/vendor-admin/orders/42?tab=2'],
    ['/orders/42?tab=2#notes', '/m/vendor-admin/orders/42?tab=2#notes'],
    ['/a/b/c', '/m/vendor-admin/a/b/c'],
    ['/a b', '/m/vendor-admin/a%20b'],
    ['/?x=1', '/m/vendor-admin?x=1'],
  ])('%s is %s', (path, expected) => {
    expect(shellUrlFor('vendor-admin', path)).toBe(expected)
  })

  it('maps the module root to /m/<id>, with no trailing slash', () => {
    expect(shellUrlFor('vendor-admin', '/')).toBe('/m/vendor-admin')
  })

  it.each([
    ['another site', 'https://evil.example/'],
    ['a protocol-relative address', '//evil.example/x'],
    ['a javascript URL', 'javascript:alert(1)'],
    ['a relative path', 'orders'],
    ['an empty path', ''],
    ['a backslash', '/\\evil.example'],
    ['a control character', '/a\nb'],
    ['a dot-dot walking to another screen', '/../admins'],
    ['dot-dots deeper', '/../../admins'],
    ['an encoded dot-dot', '/%2e%2e/admins'],
    ['a mixed-case encoded dot-dot', '/%2E%2e/admins'],
    ['a dot-dot to a sibling module', '/../other-module/x'],
    ['a dot-dot to the home page', '/../..'],
    ['a dot-dot to a module with a longer name', '/../vendor-admin-evil/x'],
  ])('refuses %s', (_name, path) => {
    expect(shellUrlFor('vendor-admin', path)).toBeUndefined()
  })

  it('allows dot segments that stay inside the module', () => {
    expect(shellUrlFor('vendor-admin', '/a/../b')).toBe('/m/vendor-admin/b')
    expect(shellUrlFor('vendor-admin', '/./a')).toBe('/m/vendor-admin/a')
    expect(shellUrlFor('vendor-admin', '/a/%2e%2e/b')).toBe('/m/vendor-admin/b')
  })

  it('does not let one module path land in another module address', () => {
    expect(shellUrlFor('vendor-admin', '/../vendor-admin2')).toBeUndefined()
    expect(shellUrlFor('vendor', '/../vendor-admin')).toBeUndefined()
  })

  it('never produces an address outside /m/<id>, whatever it is given', () => {
    const attempts = ['/..', '/../', '/%2e%2e', '/%2e%2e%2f', '/..%2fadmins', '/a/../../admins', '/;/../admins', '/.%2e/admins', '/\t/../admins']
    for (const path of attempts) {
      const url = shellUrlFor('vendor-admin', path)
      if (url !== undefined) {
        expect(url === '/m/vendor-admin' || url.startsWith('/m/vendor-admin/') || url.startsWith('/m/vendor-admin?')).toBe(true)
      }
    }
  })

  it('knows a module base path', () => {
    expect(moduleBasePath('vendor-admin')).toBe('/m/vendor-admin')
  })
})

describe('the module path an address stands for', () => {
  const at = (pathname: string, search = '', hash = '') => modulePathFrom('vendor-admin', { pathname, search, hash })

  it('is the part after /m/<id>, with the query and hash', () => {
    expect(at('/m/vendor-admin/orders/42', '?tab=2', '#notes')).toBe('/orders/42?tab=2#notes')
  })

  it('is / for the module root, with or without a trailing slash', () => {
    expect(at('/m/vendor-admin')).toBe('/')
    expect(at('/m/vendor-admin/')).toBe('/')
    expect(at('/m/vendor-admin', '?x=1')).toBe('/?x=1')
  })

  it('round-trips with the address for any path inside the module', () => {
    for (const path of ['/', '/orders', '/orders/42?tab=2#notes', '/a%20b', '/?x=1']) {
      const url = new URL(shellUrlFor('vendor-admin', path)!, 'https://shell.invalid')
      expect(at(url.pathname, url.search, url.hash)).toBe(path)
    }
  })
})
