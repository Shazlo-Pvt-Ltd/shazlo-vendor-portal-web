/** A mistake in how the protocol was set up (not a bad message): the build or the page should fail, loudly. */
export class ProtocolConfigError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'ProtocolConfigError'
  }
}

const LOOPBACK = new Set(['localhost', '127.0.0.1', '[::1]'])

/**
 * Checks an origin the protocol will post to and trust, and returns it. It must be one exact origin
 * (`https://host[:port]`): never `*`, a pattern, a path or a missing value. `http` is allowed only
 * for a loopback host in a development build.
 */
export function assertExactOrigin(origin: unknown, options: { development: boolean; name: string }): string {
  const { name } = options
  if (typeof origin !== 'string' || origin.trim() === '') {
    throw new ProtocolConfigError(`${name} is not set.`)
  }
  if (origin.includes('*')) {
    throw new ProtocolConfigError(`${name} must be one exact origin, not a wildcard.`)
  }
  let url: URL
  try {
    url = new URL(origin)
  } catch {
    throw new ProtocolConfigError(`${name} is not a valid origin.`)
  }
  if (url.origin !== origin || url.origin === 'null') {
    throw new ProtocolConfigError(
      `${name} must be only the scheme, host and port (for example https://one.shazlo.com), with no path or trailing slash.`,
    )
  }
  if (url.protocol === 'https:') return origin
  if (url.protocol === 'http:' && options.development && LOOPBACK.has(url.hostname)) return origin
  throw new ProtocolConfigError(
    `${name} must use https${options.development ? ' (http is allowed only for localhost)' : ' outside a development build'}.`,
  )
}
