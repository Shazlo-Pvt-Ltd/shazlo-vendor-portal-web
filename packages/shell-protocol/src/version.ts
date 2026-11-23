import { PROTOCOL_VERSION } from './constants'

/** The versions the shell speaks: the current one and the previous one (when there is one). */
export function shellSupportedVersions(current: number = PROTOCOL_VERSION): number[] {
  return current > 1 ? [current, current - 1] : [current]
}

/** The highest version both sides support, or undefined when they share none. */
export function negotiateVersion(a: readonly number[], b: readonly number[]): number | undefined {
  const common = a.filter((version) => b.includes(version))
  return common.length === 0 ? undefined : Math.max(...common)
}
