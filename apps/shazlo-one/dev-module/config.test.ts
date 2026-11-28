import { describe, expect, it } from 'vitest'
import { MODULE_DEV_PORT, SHELL_DEV_ORIGIN, VENDOR_API_DEV_ORIGIN, readModuleConfig } from './config'

const dev = { development: true }
const prod = { development: false }

describe('the module settings', () => {
  it('fall back to the local origins in development only', () => {
    expect(readModuleConfig({}, dev)).toEqual({
      ok: true,
      config: { shellOrigin: SHELL_DEV_ORIGIN, vendorApiOrigin: VENDOR_API_DEV_ORIGIN, development: true },
    })
    const missing = readModuleConfig({}, prod)
    expect(missing.ok).toBe(false)
    expect(!missing.ok && missing.problems).toHaveLength(2)
    expect(!missing.ok && missing.problems.join(' ')).toMatch(/VITE_SHELL_ORIGIN is not set/)
  })

  it('takes exact https origins', () => {
    const result = readModuleConfig({ VITE_SHELL_ORIGIN: 'https://one.shazlo.test', VITE_VENDOR_API_URL: 'https://vendor.shazlo.test' }, prod)
    expect(result).toEqual({
      ok: true,
      config: { shellOrigin: 'https://one.shazlo.test', vendorApiOrigin: 'https://vendor.shazlo.test', development: false },
    })
  })

  it.each(['*', 'https://*.shazlo.test', 'https://one.shazlo.test/', 'https://one.shazlo.test/app', 'one.shazlo.test'])(
    'refuses %s as the shell origin, so the module never posts to or trusts it',
    (value) => {
      const result = readModuleConfig({ VITE_SHELL_ORIGIN: value }, dev)
      expect(result.ok).toBe(false)
      expect(!result.ok && result.problems[0]).toMatch(/VITE_SHELL_ORIGIN/)
    },
  )

  it('refuses http outside localhost and outside development', () => {
    expect(readModuleConfig({ VITE_SHELL_ORIGIN: 'http://one.shazlo.test' }, dev).ok).toBe(false)
    expect(readModuleConfig({ VITE_SHELL_ORIGIN: 'http://localhost:5173', VITE_VENDOR_API_URL: 'http://localhost:8002' }, prod).ok).toBe(false)
  })

  it('holds a settings problem for each bad value, naming the setting and never the value', () => {
    const result = readModuleConfig({ VITE_SHELL_ORIGIN: '*', VITE_VENDOR_API_URL: 'https://user:secret@vendor.test' }, dev)
    expect(result.ok).toBe(false)
    const problems = (!result.ok && result.problems) || []
    expect(problems).toHaveLength(2)
    expect(problems.join(' ')).toMatch(/VITE_SHELL_ORIGIN/)
    expect(problems.join(' ')).toMatch(/VITE_VENDOR_API_URL/)
    expect(problems.join(' ')).not.toContain('secret')
  })

  it('names its own port, which the shell’s development registry uses', () => {
    expect(MODULE_DEV_PORT).toBe(5175)
  })
})
