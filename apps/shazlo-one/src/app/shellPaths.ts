/**
 * The screens the shell itself owns, as data, so the `return-to` check and the router agree on them.
 * Later issues add the module routes here.
 */
export interface ShellPath {
  path: string
  /** `public`: signed-out only (login). `passwordChange`: the one screen a first-login admin may see. `auth`: signed in. */
  access: 'public' | 'passwordChange' | 'auth'
}

export const LOGIN_PATH = '/login'
export const CHANGE_PASSWORD_PATH = '/change-password'
export const ADMINS_PATH = '/admins'

export const shellPaths: readonly ShellPath[] = [
  { path: '/', access: 'auth' },
  // A module and the rest of its path, which belongs to the module.
  { path: '/m/:moduleId/*', access: 'auth' },
  { path: ADMINS_PATH, access: 'auth' },
  { path: LOGIN_PATH, access: 'public' },
  { path: CHANGE_PASSWORD_PATH, access: 'passwordChange' },
]
