/**
 * The origins of the registered admin modules: the only places the shell may frame (CSP
 * `frame-src`). The module registry (its own issue) fills this in; until then the shell frames
 * nothing. It lives here, apart from the registry's React code, so the Vite config and the Vercel
 * header script can read it without loading the app.
 */
export const MODULE_ORIGINS: readonly string[] = []
