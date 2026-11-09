import { zodResolver } from '@hookform/resolvers/zod'
import { Box, Button, IconButton, InputAdornment, Link, Skeleton, Stack, TextField } from '@mui/material'
import { Banner, EmptyIllustration, neutral, status } from '@shazlo/ui'
import { Circle, CircleCheck, Eye, EyeOff } from 'lucide-react'
import { useId, useMemo, useState } from 'react'
import { useForm, useWatch } from 'react-hook-form'
import { Link as RouterLink, useNavigate, useSearchParams } from 'react-router'
import { z } from 'zod'
import { ApiError } from '../../api/client'

import { useAcceptInvite, useInvite } from '../../api/queries'
import { paths } from '../../app/paths'
import { useSession } from '../../auth/session'
import { onboardingCopy } from '../../copy/onboarding'
import { fieldProps } from '../../lib/forms'
import { AuthLayout, AuthTitle } from './AuthLayout'

const copy = onboardingCopy.setPassword

type Invite = { email: string; brand_name: string; owner_name: string }
type RuleKey = keyof typeof copy.rules
const RULES = Object.keys(copy.rules) as RuleKey[]

const srOnly = { position: 'absolute', width: 1, height: 1, p: 0, m: -1, overflow: 'hidden', clip: 'rect(0 0 0 0)', whiteSpace: 'nowrap', border: 0 } as const

const squash = (s: string) => s.toLowerCase().replace(/[^\p{L}\p{N}]/gu, '')

// The field is described by each rule item (not the list, whose own label would win).
const ruleIds = (id: string) => RULES.map((key) => `${id}-${key}`)

// Options board pick: rules that tick off as you type. Nothing is met until something is typed.
function checkRules(password: string, invite: Invite): Record<RuleKey, boolean> {
  const typed = squash(password)
  const email = squash(invite.email)
  const local = squash(invite.email.split('@')[0] ?? '')
  const brandName = squash(invite.brand_name)
  const personal = typed.length > 0 && !(email && typed.includes(email)) && !(brandName && typed.includes(brandName)) && !(local.length >= 3 && typed === local)
  return {
    length: Array.from(password).length >= 10,
    personal,
    mix: /[\p{N}\p{P}\p{S}]/u.test(password),
  }
}

function schemaFor(invite: Invite) {
  return z.object({ password: z.string(), confirm: z.string() }).superRefine(({ password, confirm }, ctx) => {
    if (!password) ctx.addIssue({ code: 'custom', path: ['password'], message: copy.errors.passwordRequired })
    else if (!Object.values(checkRules(password, invite)).every(Boolean)) ctx.addIssue({ code: 'custom', path: ['password'], message: copy.errors.rules })
    if (!confirm) ctx.addIssue({ code: 'custom', path: ['confirm'], message: copy.errors.confirmRequired })
    else if (confirm !== password) ctx.addIssue({ code: 'custom', path: ['confirm'], message: copy.errors.mismatch })
  })
}
type Values = { password: string; confirm: string }

function RuleList({ id, rules }: { id: string; rules: Record<RuleKey, boolean> }) {
  const met = RULES.filter((k) => rules[k]).length
  return (
    <>
      <Box component="ul" role="list" aria-label={copy.rulesLabel} sx={{ listStyle: 'none', p: 0, m: 0, mt: -1, display: 'grid', gap: 0.75 }}>
        {RULES.map((key) => {
          const ok = rules[key]
          const Icon = ok ? CircleCheck : Circle
          return (
            <Box component="li" key={key} id={`${id}-${key}`} sx={{ display: 'flex', alignItems: 'center', gap: 1, typography: 'body2', color: ok ? 'text.primary' : 'text.secondary' }}>
              <Box component="span" sx={{ display: 'flex', flexShrink: 0, color: ok ? status.success : neutral.inkTertiary }}>
                <Icon size={16} strokeWidth={1.5} aria-hidden="true" />
              </Box>
              <span>{copy.rules[key]}</span>
              <Box component="span" sx={srOnly}>
                {ok ? copy.met : copy.notMet}
              </Box>
            </Box>
          )
        })}
      </Box>
      <Box role="status" sx={srOnly}>
        {copy.summary(met, RULES.length)}
      </Box>
    </>
  )
}

function PasswordForm({ token, invite, onExpired, onAccepted }: { token: string; invite: Invite; onExpired: () => void; onAccepted: () => void }) {
  const { adopt } = useSession()
  const navigate = useNavigate()
  const accept = useAcceptInvite()
  const [showPassword, setShowPassword] = useState(false)
  const [failure, setFailure] = useState<string | null>(null)
  const schema = useMemo(() => schemaFor(invite), [invite])
  const { register, handleSubmit, control, setError, formState } = useForm<Values>({ resolver: zodResolver(schema), defaultValues: { password: '', confirm: '' } })
  const password = useWatch({ control, name: 'password' })
  const rules = checkRules(password, invite)
  const passwordId = useId()
  const rulesId = useId()
  const errors = formState.errors

  const onSubmit = handleSubmit(async (values) => {
    setFailure(null)
    try {
      const pair = await accept.mutateAsync({ token, password: values.password })
      onAccepted()
      adopt(pair)
      navigate(paths.overview, { replace: true })
    } catch (error) {
      if (error instanceof ApiError && error.status === 404) onExpired()
      else if (error instanceof ApiError && error.fields.password) setError('password', { type: 'server', message: error.fields.password }, { shouldFocus: true })
      else setFailure(error instanceof ApiError ? error.message : copy.loadFailed)
    }
  })

  const firstName = invite.owner_name.trim().split(/\s+/)[0] ?? invite.owner_name
  return (
    <>
      <AuthTitle title={copy.title} subtitle={<Box component="span" sx={{ overflowWrap: 'anywhere' }}>{copy.subtitle(firstName, invite.email, invite.brand_name)}</Box>} />
      <Box component="form" noValidate onSubmit={onSubmit}>
        {/* Lets password managers save the new password against the right account. */}
        <input type="email" name="username" autoComplete="username" value={invite.email} readOnly hidden />
        <Stack spacing={2.5}>
          {failure && <Banner tone="error" title={failure} />}
          <TextField
            id={passwordId}
            label={copy.password}
            type={showPassword ? 'text' : 'password'}
            autoComplete="new-password"
            {...fieldProps(register('password'), errors.password)}
            slotProps={{
              htmlInput: { 'aria-describedby': [errors.password ? `${passwordId}-helper-text` : null, ...ruleIds(rulesId)].filter(Boolean).join(' '), autoCapitalize: 'none', spellCheck: false },
              input: {
                endAdornment: (
                  <InputAdornment position="end">
                    <IconButton aria-label={showPassword ? copy.hidePassword : copy.showPassword} onClick={() => setShowPassword((s) => !s)} edge="end" sx={{ width: 44, height: 44 }}>
                      {showPassword ? <EyeOff size={18} strokeWidth={1.5} aria-hidden="true" /> : <Eye size={18} strokeWidth={1.5} aria-hidden="true" />}
                    </IconButton>
                  </InputAdornment>
                ),
              },
            }}
          />
          <RuleList id={rulesId} rules={rules} />
          <TextField label={copy.confirm} type="password" autoComplete="new-password" {...fieldProps(register('confirm'), errors.confirm)} />
          <Button type="submit" variant="contained" size="large" fullWidth disabled={formState.isSubmitting} sx={{ minHeight: 44 }}>
            {formState.isSubmitting ? copy.submitting : copy.submit}
          </Button>
        </Stack>
      </Box>
    </>
  )
}

function InviteExpired() {
  const e = copy.expired
  return (
    <Stack sx={{ alignItems: 'center', textAlign: 'center' }}>
      <Box sx={{ mb: 2 }}>
        <EmptyIllustration name="clock" />
      </Box>
      <AuthTitle
        title={e.title}
        subtitle={
          <>
            {e.bodyBefore} <Link href={`mailto:${onboardingCopy.partnersEmail}`}>{onboardingCopy.partnersEmail}</Link> {e.bodyAfter}
          </>
        }
      />
      <Button variant="contained" size="large" component={RouterLink} to={paths.signIn} sx={{ minHeight: 44 }}>
        {e.action}
      </Button>
    </Stack>
  )
}

function FormSkeleton() {
  return (
    <Box aria-hidden="true">
      <Skeleton variant="text" width="70%" sx={{ fontSize: '2.25rem' }} />
      <Skeleton variant="text" width="100%" />
      <Skeleton variant="text" width="60%" sx={{ mb: 4 }} />
      <Stack spacing={2.5}>
        <Skeleton variant="rounded" height={56} />
        <Stack spacing={1}>
          {[0, 1, 2].map((i) => (
            <Skeleton key={i} variant="text" width="55%" />
          ))}
        </Stack>
        <Skeleton variant="rounded" height={56} />
        <Skeleton variant="rounded" height={44} />
      </Stack>
    </Box>
  )
}

export default function SetPassword() {
  const [params] = useSearchParams()
  const token = params.get('token')
  const [expired, setExpired] = useState(false)
  // Once accepted, stop reading the (now used) invite while the overview loads.
  const [accepted, setAccepted] = useState(false)
  const invite = useInvite(accepted ? null : token)
  const notFound = invite.error instanceof ApiError && invite.error.status === 404

  let body
  if (!token || expired || notFound) body = <InviteExpired />
  else if (invite.isError) {
    body = (
      <Banner
        tone="error"
        title={copy.loadFailed}
        action={
          <Button variant="outlined" size="small" onClick={() => void invite.refetch()}>
            {copy.retry}
          </Button>
        }
      >
        {invite.error.message}
      </Banner>
    )
  } else if (!invite.data) body = <FormSkeleton />
  else body = <PasswordForm token={token} invite={invite.data} onExpired={() => setExpired(true)} onAccepted={() => setAccepted(true)} />

  return <AuthLayout>{body}</AuthLayout>
}
