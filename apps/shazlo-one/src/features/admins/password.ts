import { PASSWORD_MIN_LENGTH } from '../../session/passwordRules'

/** Letters and digits that cannot be mistaken for each other when read aloud or copied by hand (no 0, O, 1, l, I). */
const ALPHABET = 'abcdefghijkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789'
export const TEMPORARY_PASSWORD_LENGTH = 20

/**
 * A random temporary password for a new admin or a reset: 20 characters from an alphabet without look-alikes,
 * about 114 bits, well past the policy's minimum. Each character is drawn without bias (a draw that would
 * favour the first few characters is thrown away). It is shown to the super admin once, to hand over; it is
 * never sent anywhere but identity-api, and the admin must change it at first sign-in.
 */
export function generateTemporaryPassword(
  random: (bytes: Uint8Array<ArrayBuffer>) => Uint8Array<ArrayBuffer> = (bytes) => {
    crypto.getRandomValues(bytes)
    return bytes
  },
): string {
  const limit = 256 - (256 % ALPHABET.length)
  let result = ''
  while (result.length < TEMPORARY_PASSWORD_LENGTH) {
    for (const byte of random(new Uint8Array(32))) {
      if (byte >= limit) continue
      result += ALPHABET[byte % ALPHABET.length]
      if (result.length === TEMPORARY_PASSWORD_LENGTH) break
    }
  }
  if (result.length < PASSWORD_MIN_LENGTH) throw new Error('A temporary password must meet the minimum length.')
  return result
}
