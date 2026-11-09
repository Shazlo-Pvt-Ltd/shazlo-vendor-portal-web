// The three V-03 password rules, checked as the vendor types. The server re-checks them
// (and hashes with Argon2id); this list only gives early, specific feedback.

export const MIN_PASSWORD_LENGTH = 12

export interface PasswordRule {
  id: 'length' | 'common' | 'email'
  label: string
  met: boolean
}

// A short list of the passwords and patterns people reach for most. The server checks a full
// breached-password list; this catches the obvious ones while typing.
const common = new Set([
  'password', 'passw0rd', 'qwerty', 'qwertyuiop', 'asdfghjkl', 'zxcvbnm', 'letmein', 'welcome', 'iloveyou', 'admin',
  'administrator', 'monkey', 'dragon', 'sunshine', 'princess', 'football', 'cricket', 'baseball', 'superman', 'trustno1',
  'abc', 'abcdef', 'abcdefgh', 'india', 'mumbai', 'delhi', 'shazlo', 'shazlostore', 'seller', 'changeme', 'secret', 'login',
])

function isCommon(password: string) {
  const lower = password.toLowerCase()
  if (common.has(lower)) return true
  // "Password@123", "welcome2026!" and the like.
  const core = lower.replace(/[^a-z]+$/, '').replace(/^[^a-z]+/, '')
  if (core && common.has(core)) return true
  if (/^(.)\1+$/.test(lower)) return true
  if ('01234567890123456789'.includes(lower) || '98765432109876543210'.includes(lower)) return true
  if ('abcdefghijklmnopqrstuvwxyz'.includes(lower) || 'qwertyuiopasdfghjklzxcvbnm'.includes(lower)) return true
  return false
}

function containsEmail(password: string, email: string) {
  const lower = password.toLowerCase()
  const address = email.trim().toLowerCase()
  if (!address) return false
  const local = address.split('@')[0] ?? ''
  return lower.includes(address) || (local.length >= 3 && lower.includes(local))
}

/** An empty password meets no rule, so the list starts unticked. */
export function checkPassword(password: string, email: string): PasswordRule[] {
  const typed = password.length > 0
  return [
    { id: 'length', label: `At least ${MIN_PASSWORD_LENGTH} characters`, met: password.length >= MIN_PASSWORD_LENGTH },
    { id: 'common', label: 'Not a commonly used password', met: typed && !isCommon(password) },
    { id: 'email', label: 'Does not contain your email', met: typed && !containsEmail(password, email) },
  ]
}
