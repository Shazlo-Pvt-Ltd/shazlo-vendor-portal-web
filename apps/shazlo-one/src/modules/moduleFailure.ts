/** A module the shell could not bring up, for whoever wants to be told (telemetry, an error tracker). */
export interface ModuleFailure {
  moduleId: string
  /** The module never sent `ready`, on the first load and on every retry. */
  reason: 'no_ready'
  /** How many loads failed in a row. */
  attempts: number
}

type Reporter = (failure: ModuleFailure) => void

let reporter: Reporter | undefined

/**
 * Registers where "module unavailable" is reported (ADR 0001, section 7). Nothing is registered by
 * default, so nothing leaves the browser; wiring a service up is one call here. A failure carries the
 * module's id and a count, never a token or an address.
 */
export function setModuleFailureReporter(next: Reporter | undefined): void {
  reporter = next
}

export function reportModuleFailure(failure: ModuleFailure): void {
  try {
    reporter?.(failure)
  } catch {
    // A broken reporter must never break the page that is already showing an error.
  }
}
