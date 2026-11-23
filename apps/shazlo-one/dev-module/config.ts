import { ProtocolConfigError, assertExactOrigin } from '@shazlo/shell-protocol'

/** Where the shell's dev server runs (identity-api's CORS expects it there too). */
export const SHELL_DEV_ORIGIN = 'http://localhost:5173'
/** Where vendor-api listens in the local compose setup. */
export const VENDOR_API_DEV_ORIGIN = 'http://localhost:8002'
/** The reference module's own origin: the shell's development registry names it. */
export const MODULE_DEV_PORT = 5175

export interface ModuleConfig {
  /** The shell's exact origin: the only one the module posts to and trusts. */
  shellOrigin: string
  /** vendor-api's origin, which the exchanged token (`aud=vendor-api`) is sent to. */
  vendorApiOrigin: string
  development: boolean
}

export interface RawModuleEnv {
  VITE_SHELL_ORIGIN?: string | undefined
  VITE_VENDOR_API_URL?: string | undefined
}

export type ConfigResult = { ok: true; config: ModuleConfig } | { ok: false; problems: string[] }

/**
 * Reads the module's settings. Both are origins and both must be exact: `VITE_SHELL_ORIGIN` goes
 * through the protocol package's check (no missing value, wildcard, pattern, path, or http outside
 * development), and `VITE_VENDOR_API_URL` follows the same rule. A development build falls back to
 * the local defaults; nothing else does.
 */
export function readModuleConfig(raw: RawModuleEnv, options: { development: boolean }): ConfigResult {
  const { development } = options
  const problems: string[] = []
  const shellValue = raw.VITE_SHELL_ORIGIN?.trim() || (development ? SHELL_DEV_ORIGIN : undefined)
  const apiValue = raw.VITE_VENDOR_API_URL?.trim() || (development ? VENDOR_API_DEV_ORIGIN : undefined)

  const check = (value: string | undefined, name: string): string | undefined => {
    try {
      return assertExactOrigin(value, { development, name })
    } catch (error) {
      if (error instanceof ProtocolConfigError) problems.push(error.message)
      else throw error
      return undefined
    }
  }
  const shellOrigin = check(shellValue, 'VITE_SHELL_ORIGIN')
  const vendorApiOrigin = check(apiValue, 'VITE_VENDOR_API_URL')
  if (problems.length > 0 || shellOrigin === undefined || vendorApiOrigin === undefined) return { ok: false, problems }
  return { ok: true, config: { shellOrigin, vendorApiOrigin, development } }
}
