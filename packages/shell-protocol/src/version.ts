import { PROTOCOL_VERSION } from './constants'
import { ProtocolConfigError } from './origin'

/** The versions the shell speaks: the current one and the previous one (when there is one). */
export function shellSupportedVersions(current: number = PROTOCOL_VERSION): number[] {
  return current > 1 ? [current, current - 1] : [current]
}

/** The highest version both sides support, or undefined when they share none. */
export function negotiateVersion(a: readonly number[], b: readonly number[]): number | undefined {
  const common = a.filter((version) => b.includes(version))
  return common.length === 0 ? undefined : Math.max(...common)
}

/**
 * Checks a list of versions one end was set up with: one to 20 positive integers. An empty list would
 * put `v: -Infinity` on the wire, which the other end drops, so the handshake would fail in silence.
 */
export function assertVersions(versions: unknown, name: string): number[] {
  if (
    !Array.isArray(versions) ||
    versions.length < 1 ||
    versions.length > 20 ||
    !versions.every((version) => typeof version === 'number' && Number.isInteger(version) && version >= 1)
  ) {
    throw new ProtocolConfigError(`${name} must be a list of one to 20 positive whole numbers.`)
  }
  return [...(versions as number[])]
}
