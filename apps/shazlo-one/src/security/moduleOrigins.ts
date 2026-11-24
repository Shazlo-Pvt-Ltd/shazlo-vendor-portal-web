/**
 * The origins of the registered modules: the only places the shell may frame (`frame-src`). The
 * module registry (Phase 6, "Module registry") fills this list; until a module is registered the
 * shell frames nothing. Every entry must be a plain https origin (http://localhost only in
 * development builds of a module).
 */
export const MODULE_ORIGINS: readonly string[] = []
