// @vitest-environment node
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { checkEmail, checkNewPassword, checkPasswordChange, checkPasswordPair, EMAIL_MAX, EMAIL_PATTERN, PASSWORD_MAX, PASSWORD_MIN } from './account'

describe('checkEmail', () => {
  it.each(['plainaddress', 'a@b', 'a b@c.com', '@c.com', 'ü@c.com', 'a@@c.com', `${'a'.repeat(310)}@brand.example`])('refuses %j', (email) => {
    expect(checkEmail(email)).toBe('Enter an email like name@brand.in.')
  })

  it('asks for an address when there is none, spaces included', () => {
    expect(checkEmail('   ')).toBe('Enter your email.')
  })

  it('accepts an address with spaces around it', () => {
    expect(checkEmail('  asha@neelthreads.in ')).toBeUndefined()
  })
})

describe('checkNewPassword', () => {
  it('needs one', () => {
    expect(checkNewPassword('')).toBe('Choose a password.')
  })

  it(`needs at least ${PASSWORD_MIN} characters, counted as typed (spaces too)`, () => {
    expect(checkNewPassword('x'.repeat(PASSWORD_MIN - 1))).toBe(`Use at least ${PASSWORD_MIN} characters.`)
    expect(checkNewPassword('x'.repeat(PASSWORD_MIN))).toBeUndefined()
    expect(checkNewPassword(' '.repeat(PASSWORD_MIN))).toBeUndefined()
  })

  it(`allows at most ${PASSWORD_MAX} characters`, () => {
    expect(checkNewPassword('x'.repeat(PASSWORD_MAX))).toBeUndefined()
    expect(checkNewPassword('x'.repeat(PASSWORD_MAX + 1))).toBe(`Use at most ${PASSWORD_MAX} characters.`)
  })

  it('counts characters, not UTF-16 units, so an emoji password is not cut short', () => {
    expect(checkNewPassword('🙂'.repeat(PASSWORD_MIN))).toBeUndefined()
    expect(checkNewPassword('🙂'.repeat(PASSWORD_MIN - 1))).toBe(`Use at least ${PASSWORD_MIN} characters.`)
  })

  it('cannot be the email address, whatever the case and spaces', () => {
    expect(checkNewPassword(' LongEnough@Brand.example ', 'longenough@brand.example')).toBe('Your password cannot be your email address.')
    expect(checkNewPassword('longenough@brand.example', '')).toBeUndefined()
  })
})

describe('checkPasswordPair', () => {
  it('checks the new password, then that both match', () => {
    expect(checkPasswordPair('', '')).toEqual({ password: 'Choose a password.' })
    expect(checkPasswordPair('short', 'short')).toEqual({ password: `Use at least ${PASSWORD_MIN} characters.` })
    expect(checkPasswordPair('a-long-enough-password', 'a-long-enough-passwore')).toEqual({ confirm: 'The passwords do not match. Type the same password in both fields.' })
    expect(checkPasswordPair('a-long-enough-password', '')).toEqual({ confirm: 'Type the same password again.' })
    expect(checkPasswordPair('a-long-enough-password', 'a-long-enough-password')).toEqual({})
  })
})

describe('checkPasswordChange', () => {
  const OLD = 'old-password-123'
  const NEW = 'a brand new passphrase'

  it('needs all three, a long enough new one, different from the current, typed twice', () => {
    expect(checkPasswordChange({ current: '', next: '', confirm: '' })).toEqual({ current: 'Enter your current password.', next: 'Choose a new password.' })
    expect(checkPasswordChange({ current: OLD, next: OLD, confirm: OLD }).next).toBe('Choose a password different from your current one.')
    expect(checkPasswordChange({ current: OLD, next: 'x'.repeat(129), confirm: 'x'.repeat(129) }).next).toBe('Use at most 128 characters.')
    expect(checkPasswordChange({ current: OLD, next: NEW, confirm: 'other' }).confirm).toBe('The new passwords do not match. Type the same password in both fields.')
    expect(checkPasswordChange({ current: OLD, next: NEW, confirm: NEW })).toEqual({})
  })

  it('cannot be the email address', () => {
    expect(checkPasswordChange({ current: OLD, next: 'kiran@kalkistudio.in', confirm: 'kiran@kalkistudio.in' }, 'Kiran@KalkiStudio.in').next).toBe('Your password cannot be your email address.')
  })
})

describe('the rules match vendor-api', () => {
  const spec = JSON.parse(readFileSync(fileURLToPath(new URL('../../../../services/vendor-api/openapi.json', import.meta.url)), 'utf8')) as {
    components: { schemas: Record<string, { properties: Record<string, Record<string, unknown>> }> }
  }
  const schema = (name: string) => spec.components.schemas[name]!.properties

  it("uses the API's email pattern and length for sign-up, resend, forgot password and invites", () => {
    for (const name of ['SignupRequest', 'ResendRequest', 'ForgotPasswordRequest', 'InviteRequest']) {
      expect(EMAIL_PATTERN.source, name).toBe(schema(name).email!.pattern)
      expect(EMAIL_MAX, name).toBe(schema(name).email!.maxLength)
    }
  })

  it("uses the API's longest password", () => {
    expect(PASSWORD_MAX).toBe(schema('SignupRequest').password!.maxLength)
    expect(PASSWORD_MAX).toBe(schema('SetPasswordRequest').password!.maxLength)
    expect(PASSWORD_MAX).toBe(schema('ChangePasswordRequest').new_password!.maxLength)
  })
})
