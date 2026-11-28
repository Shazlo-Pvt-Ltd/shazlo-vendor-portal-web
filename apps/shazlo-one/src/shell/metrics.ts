// The heights of the shell's sticky header, in px. A module's iframe fills what is left of the
// screen: ShellLayout sets --shell-top to the header's height, and ModuleHost sizes the iframe to
// calc(100dvh - var(--shell-top)), so the page never gets a second scrollbar.
export const TOP = 56
// Phones stack the navy bar and a one-crumb bar.
export const PHONE_CRUMBS = 44
// Inside a module the header gains a row with the module's pages (its links stay 44 px or taller
// on phones, above the row's 1 px rule).
export const MODULE_NAV = 48

export function shellTop({ phone, moduleNav }: { phone: boolean; moduleNav: boolean }): number {
  return (phone ? TOP + PHONE_CRUMBS : TOP) + (moduleNav ? MODULE_NAV : 0)
}
