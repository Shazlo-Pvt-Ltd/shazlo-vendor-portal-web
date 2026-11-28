import { Box, Button, CircularProgress, Divider, Link, Stack, Typography } from '@mui/material'
import { Banner } from '@shazlo/ui'
import { useEffect, useRef, useState } from 'react'
import { Link as RouterLink, useLocation, useNavigate } from 'react-router'
import { ApiError } from '../../api/errors'
import { useVerifyEmail } from '../../api/queries'
import { paths } from '../../app/paths'
import { onboardingCopy } from '../../copy/onboarding'
import { failureOf } from '../../lib/failure'
import { linkToken } from '../../lib/linkToken'
import { useCountdown } from '../../session/useCountdown'
import { AuthLayout, AuthTitle } from './AuthLayout'
import { ResendEmail } from './ResendEmail'
import { WaitBanner } from './WaitBanner'

const copy = onboardingCopy.verify

type State = { name: 'checking' } | { name: 'confirmed' } | { name: 'invalid' } | { name: 'problem'; message: string }

// The answers that mean "this link is no good": used, too old, or not a token at all.
const isBadLink = (error: unknown) => error instanceof ApiError && [400, 404, 422].includes(error.status)

/**
 * The page the emailed link opens: `/verify-email#token=…` (main's VerifyEmailPage). The token is
 * read once into memory, removed from the address bar and the history, and spent exactly once
 * (StrictMode runs effects twice). Confirmed: sign in. Used or old: ask for a new link. The server
 * out of reach: try again.
 */
export default function VerifyEmail() {
  const location = useLocation()
  const navigate = useNavigate()
  const [token] = useState(() => linkToken(location))
  const [state, setState] = useState<State>(token === '' ? { name: 'invalid' } : { name: 'checking' })
  const spent = useRef(false)
  const heading = useRef<HTMLHeadingElement>(null)
  const verify = useVerifyEmail()
  const wait = useCountdown()

  async function spend() {
    setState({ name: 'checking' })
    try {
      await verify.mutateAsync(token)
      setState({ name: 'confirmed' })
    } catch (error) {
      if (isBadLink(error)) {
        setState({ name: 'invalid' })
        return
      }
      const { message, retryAfter } = failureOf(error)
      setState({ name: 'problem', message })
      if (retryAfter) wait.start(retryAfter)
    } finally {
      verify.reset()
    }
  }

  useEffect(() => {
    // The token is a credential until it is spent: out of the address bar and the history at once.
    if (location.hash !== '' || location.search !== '') void navigate(location.pathname, { replace: true })
    if (token === '' || spent.current) return
    spent.current = true
    void spend()
    // Once per page load: the token never changes.
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (state.name !== 'checking') heading.current?.focus()
  }, [state.name])

  let body
  switch (state.name) {
    case 'checking':
      body = (
        <Stack role="status" direction="row" spacing={2} sx={{ alignItems: 'center' }}>
          <CircularProgress size={24} color="inherit" aria-hidden="true" />
          <Typography variant="pageTitle" component="h1" sx={{ fontSize: '1.5rem', lineHeight: 1.2 }}>
            {copy.checking}
          </Typography>
        </Stack>
      )
      break
    case 'confirmed':
      body = (
        <>
          <AuthTitle headingRef={heading} title={copy.confirmedTitle} subtitle={copy.confirmedBody} />
          <Button variant="contained" size="large" fullWidth component={RouterLink} to={paths.signIn} sx={{ minHeight: 44 }}>
            {copy.signIn}
          </Button>
        </>
      )
      break
    case 'invalid':
      body = (
        <>
          <AuthTitle
            headingRef={heading}
            title={copy.invalidTitle}
            subtitle={
              <>
                {copy.invalidBody}{' '}
                <Link component={RouterLink} to={paths.signIn}>
                  {copy.invalidSignIn}
                </Link>
                {copy.invalidAfter}
              </>
            }
          />
          <ResendEmail primary />
        </>
      )
      break
    case 'problem':
      body = (
        <>
          <AuthTitle headingRef={heading} title={copy.problemTitle} />
          <Stack spacing={2.5}>
            {wait.active ? <WaitBanner seconds={wait.remaining} /> : <Banner tone="error" title={state.message} />}
            <Button variant="contained" size="large" fullWidth onClick={() => void spend()} disabled={wait.active} sx={{ minHeight: 44 }}>
              {copy.tryAgain}
            </Button>
          </Stack>
          <Divider sx={{ my: 3 }} />
          <Box>
            <Link component={RouterLink} to={paths.signIn} variant="body1">
              {onboardingCopy.setPassword.backToSignIn}
            </Link>
          </Box>
        </>
      )
      break
  }

  return <AuthLayout>{body}</AuthLayout>
}
