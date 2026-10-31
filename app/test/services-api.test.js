import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { AxiosError } from 'axios'
import api, { healthCheck, preRegisterAPI } from '../src/services/api'

let adapter
const originalAdapter = api.defaults.adapter
beforeEach(() => {
  adapter = vi.fn(async (config) => ({ data: { ok: true }, status: 200, statusText: 'OK', headers: {}, config }))
  api.defaults.adapter = adapter
})
afterEach(() => { api.defaults.adapter = originalAdapter })

describe('Axios API and session interceptors', () => {
  it('attaches a stored bearer token to the real Axios request pipeline', async () => {
    localStorage.setItem('authToken', 'session-token')
    await healthCheck()
    expect(adapter.mock.calls[0][0].headers.get('Authorization')).toBe('Bearer session-token')
  })

  it('does not send an authorization header for anonymous requests', async () => {
    await healthCheck()
    expect(adapter.mock.calls[0][0].headers.get('Authorization')).toBeUndefined()
  })

  it.each([401, 403, 500])('propagates HTTP %i and clears credentials only for 401', async (status) => {
    localStorage.setItem('authToken', 'session-token')
    adapter.mockImplementation(async (config) => {
      throw new AxiosError('request failed', 'ERR_BAD_RESPONSE', config, {}, { status, data: {}, headers: {}, statusText: 'Failed', config })
    })
    await expect(healthCheck()).rejects.toThrow('request failed')
    expect(localStorage.getItem('authToken')).toBe(status === 401 ? null : 'session-token')
  })

  it.each([
    ['health', () => healthCheck(), 'get', '/health'],
    ['check email', () => preRegisterAPI.checkEmail('a+b@example.test'), 'get', '/preregister/check/a%2Bb%40example.test'],
    ['confirm', () => preRegisterAPI.confirm('confirmation-123'), 'get', '/preregister/confirm/confirmation-123'],
    ['stats', () => preRegisterAPI.getStats(), 'get', '/preregister/stats'],
  ])('unwraps the %s response and uses the expected path', async (_name, call, method, path) => {
    await expect(call()).resolves.toEqual({ ok: true })
    expect(adapter.mock.calls[0][0]).toMatchObject({ method, url: path, timeout: 10000 })
  })

  it('serializes a registration payload through Axios', async () => {
    const data = { name: 'Asha', email: 'asha@example.test', interests: ['fashion'] }
    await expect(preRegisterAPI.register(data)).resolves.toEqual({ ok: true })
    expect(adapter.mock.calls[0][0]).toMatchObject({ method: 'post', url: '/preregister/register' })
    expect(JSON.parse(adapter.mock.calls[0][0].data)).toEqual(data)
  })
})
