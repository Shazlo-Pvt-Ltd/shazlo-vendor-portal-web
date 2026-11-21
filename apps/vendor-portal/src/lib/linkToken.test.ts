import { describe, expect, it } from 'vitest'
import { linkToken, TOKEN_MAX } from './linkToken'

describe('linkToken', () => {
  it('reads the token from the fragment, where vendor-api puts it', () => {
    expect(linkToken({ hash: '#token=abc123', search: '' })).toBe('abc123')
  })

  it('decodes what vendor-api percent-encodes', () => {
    expect(linkToken({ hash: '#token=a%20b%26c%23d%2Fe', search: '' })).toBe('a b&c#d/e')
  })

  it('also accepts a ?token= query', () => {
    expect(linkToken({ hash: '', search: '?token=abc123' })).toBe('abc123')
  })

  it('prefers the fragment when both are present', () => {
    expect(linkToken({ hash: '#token=from-fragment', search: '?token=from-query' })).toBe('from-fragment')
  })

  it.each([
    { hash: '', search: '' },
    { hash: '#', search: '' },
    { hash: '#other=1', search: '?x=2' },
    { hash: '#token=', search: '' },
    { hash: '#token=%20%20', search: '' },
  ])('is empty when there is no token: %j', (location) => {
    expect(linkToken(location)).toBe('')
  })

  it('is empty for a token longer than vendor-api accepts, so nothing is sent', () => {
    expect(linkToken({ hash: `#token=${'a'.repeat(TOKEN_MAX)}`, search: '' })).toHaveLength(TOKEN_MAX)
    expect(linkToken({ hash: `#token=${'a'.repeat(TOKEN_MAX + 1)}`, search: '' })).toBe('')
  })

  it('is empty, not an error, for a fragment that is not valid percent-encoding', () => {
    expect(() => linkToken({ hash: '#token=%E0%A4%A', search: '' })).not.toThrow()
  })
})
