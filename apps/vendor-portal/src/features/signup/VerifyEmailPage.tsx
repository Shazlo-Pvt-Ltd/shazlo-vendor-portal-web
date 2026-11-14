import { Alert, Box, Button, CircularProgress, Link as MuiLink, Typography } from '@mui/material'
import { useEffect, useRef, useState } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router'
import { api } from '../../api'
import { ApiError } from '../../api/errors'
import { usePageTitle } from '../../hooks/usePageTitle'
import { friendlyError } from '../errors'
import { ResendVerification } from './ResendVerification'
import { useCountdown } from './useCountdown'

type State =
  | { name: 'verifying' }
  | { name: 'verified' }
  | { name: 'invalid' }
  | { name: 'problem'; message: string; retryAfter?: number }

/**
 * The page the emailed link opens: `/verify-email?token=…`. The token is single-use, so it is spent
 * exactly once (StrictMode runs effects twice in development) and then removed from the address bar.
 */
export function VerifyEmailPage() {
  usePageTitle('Verify your email')
  const [params] = useSearchParams()
  const navigate = useNavigate()
  const [token] = useState(() => params.get('token')?.trim() ?? '')
  const [state, setState] = useState<State>(token === '' ? { name: 'invalid' } : { name: 'verifying' })
  const spent = useRef(false)
  const heading = useRef<HTMLHeadingElement>(null)
  const countdown = useCountdown()
  const verify = api.useMutation('post', '/v1/auth/verify-email')

  async function spend() {
    setState({ name: 'verifying' })
    try {
      await verify.mutateAsync({ body: { token } })
      setState({ name: 'verified' })
    } catch (caught) {
      if (caught instanceof ApiError && caught.status === 400) {
        setState({ name: 'invalid' })
        return
      }
      const friendly = friendlyError(caught)
      setState({ name: 'problem', message: friendly.message, retryAfter: friendly.retryAfter })
      if (friendly.retryAfter) countdown.start(friendly.retryAfter)
    }
  }

  useEffect(() => {
    if (token === '' || spent.current) return
    spent.current = true
    // Take the token out of the address bar and the history: it is a credential until it is spent.
    void navigate('/verify-email', { replace: true })
    void spend()
  }, [])

  useEffect(() => {
    if (state.name !== 'verifying') heading.current?.focus()
  }, [state.name])

  return (
    <Box component="main" sx={{ p: 2, maxWidth: 560, mx: 'auto', mt: { xs: 2, sm: 6 } }}>
      {state.name === 'verifying' ? (
        <Box role="status" aria-live="polite" sx={{ display: 'flex', alignItems: 'center', gap: 2 }}>
          <CircularProgress size={24} aria-hidden="true" />
          <Typography component="h1" variant="h5">
            Verifying your email…
          </Typography>
        </Box>
      ) : null}

      {state.name === 'verified' ? (
        <>
          <Typography component="h1" variant="h4" gutterBottom tabIndex={-1} ref={heading}>
            Your email is verified
          </Typography>
          <Typography sx={{ mb: 3 }}>Thank you. You can now sign in to your vendor account.</Typography>
          <Button component={Link} to="/login" variant="contained" size="large">
            Sign in
          </Button>
        </>
      ) : null}

      {state.name === 'invalid' ? (
        <>
          <Typography component="h1" variant="h4" gutterBottom tabIndex={-1} ref={heading}>
            This link has expired or was already used
          </Typography>
          <Typography>
            Verification links work once and expire after a while. If you already verified your email, you can{' '}
            <MuiLink component={Link} to="/login">
              sign in
            </MuiLink>
            . Otherwise ask for a new link.
          </Typography>
          <ResendVerification />
        </>
      ) : null}

      {state.name === 'problem' ? (
        <>
          <Typography component="h1" variant="h4" gutterBottom tabIndex={-1} ref={heading}>
            We couldn't verify your email
          </Typography>
          <Alert severity="error" role="alert" sx={{ mb: 2 }}>
            {state.message}
            {countdown.active ? ` Try again in ${countdown.remaining} s.` : ''}
          </Alert>
          <Button variant="contained" onClick={() => void spend()} disabled={countdown.active}>
            Try again
          </Button>
        </>
      ) : null}
    </Box>
  )
}
