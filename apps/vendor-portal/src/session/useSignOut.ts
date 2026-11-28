import { useCallback } from 'react'
import { useNavigate } from 'react-router'
import { useSession } from './AuthProvider'
import { LOGIN_PATH } from './returnTo'

/**
 * Signs out (the server, then this tab and the others; caches, drafts and typed passwords are
 * cleared) and goes to a plain login, which does not send the next person back to this page.
 */
export function useSignOut(): () => Promise<void> {
  const { logout } = useSession()
  const navigate = useNavigate()
  return useCallback(async () => {
    await logout()
    await navigate(LOGIN_PATH, { replace: true })
  }, [logout, navigate])
}
