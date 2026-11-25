import { describe, expect, it } from 'vitest'
import { toApiError } from './http'

const res = (status: number, headers: Record<string, string> = {}) => new Response(null, { status, headers })
const envelope = (code: string, message: string, details?: unknown) => ({ error: { code, message, request_id: 'req-1', ...(details === undefined ? {} : { details }) } })

describe('toApiError (identity-api and vendor-api envelope)', () => {
  it('reads code, message and request id from {error: {...}}', () => {
    const e = toApiError(res(409), envelope('email_taken', 'An admin with this email already exists'))
    expect(e.status).toBe(409)
    expect(e.code).toBe('email_taken')
    expect(e.message).toBe('An admin with this email already exists')
    expect(e.requestId).toBe('req-1')
    expect(e.fields).toEqual({ email: 'An admin with this email already exists' })
  })

  it('prefers the X-Request-Id header over the body', () => {
    expect(toApiError(res(500, { 'X-Request-Id': 'from-header' }), envelope('internal_error', 'Internal server error')).requestId).toBe('from-header')
  })

  it('turns a 422 into field errors, dropping the location prefix', () => {
    const e = toApiError(
      res(422),
      envelope('validation_error', 'Request validation failed', [
        { loc: ['body', 'email'], msg: 'value is not a valid email address', type: 'value_error' },
        { loc: ['body', 'email'], msg: 'second message is ignored', type: 'x' },
        { loc: ['body', 'roles', 0], msg: 'Value error, bad role', type: 'value_error' },
        { loc: [], msg: 'whole body is wrong', type: 'x' },
      ]),
    )
    expect(e.fields).toEqual({ email: 'value is not a valid email address', 'roles.0': 'bad role', _form: 'whole body is wrong' })
  })

  it('ignores details that are not a list, or have no message', () => {
    expect(toApiError(res(422), envelope('validation_error', 'x', 'nope')).fields).toEqual({})
    expect(toApiError(res(422), envelope('validation_error', 'x', [null, { loc: ['body', 'a'] }])).fields).toEqual({})
  })

  it('does not read details on other statuses', () => {
    expect(toApiError(res(400), envelope('bad', 'x', [{ loc: ['body', 'a'], msg: 'm' }])).fields).toEqual({})
  })

  it('puts service-level 422 codes on the field the screens show them under', () => {
    expect(toApiError(res(422), envelope('weak_password', 'Password is too common')).fields).toEqual({ password: 'Password is too common', new_password: 'Password is too common' })
    expect(toApiError(res(422), envelope('unknown_role', 'Unknown role: nope')).fields).toEqual({ roles: 'Unknown role: nope' })
    expect(toApiError(res(400), envelope('invalid_current_password', 'The current password is wrong')).fields).toEqual({ current_password: 'The current password is wrong' })
    expect(toApiError(res(409), envelope('email_taken', 'An admin with this email already exists')).fields).toEqual({ email: 'An admin with this email already exists' })
  })

  it('reads Retry-After on 429', () => {
    expect(toApiError(res(429, { 'Retry-After': '42' }), envelope('rate_limited', 'Too many requests. Try again later.')).retryAfter).toBe(42)
    expect(toApiError(res(429), envelope('rate_limited', 'x')).retryAfter).toBeUndefined()
  })

  it('falls back per status when the body is not an envelope', () => {
    expect(toApiError(res(401), undefined).message).toMatch(/Sign in again/)
    expect(toApiError(res(403), {}).message).toMatch(/role/)
    expect(toApiError(res(404), 'html').code).toBe('http_404')
    expect(toApiError(res(409), null).message).toMatch(/changed somewhere else/)
    expect(toApiError(res(429), { error: 'wrong shape' }).message).toMatch(/Too many/)
    expect(toApiError(res(502), '<html>').message).toMatch(/Try again in a moment/)
  })

  it('falls back when the envelope has an empty message', () => {
    expect(toApiError(res(404), envelope('admin_not_found', '')).message).toMatch(/could not find/)
    expect(toApiError(res(404), envelope('admin_not_found', '')).code).toBe('admin_not_found')
  })
})
