import { describe, expect, it } from 'vitest'
import { MODULE_NAV, PHONE_CRUMBS, shellTop, TOP } from './metrics'

describe('shell header height (--shell-top)', () => {
  it('is the bar, plus the phone crumb bar, plus the module pages row inside a module', () => {
    expect([TOP, PHONE_CRUMBS, MODULE_NAV]).toEqual([56, 44, 48])
    expect(shellTop({ phone: false, moduleNav: false })).toBe(56)
    expect(shellTop({ phone: false, moduleNav: true })).toBe(104)
    expect(shellTop({ phone: true, moduleNav: false })).toBe(100)
    expect(shellTop({ phone: true, moduleNav: true })).toBe(148)
  })
})
