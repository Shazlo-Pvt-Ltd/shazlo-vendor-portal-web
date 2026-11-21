import { zodResolver } from '@hookform/resolvers/zod'
import { Box, Button, Card, IconButton, InputAdornment, Link, Stack, TextField, Typography } from '@mui/material'
import { Banner, fontFamily, Logo, neutral, status, useSnackbar } from '@shazlo/ui'
import { Circle, CircleCheck, Eye, EyeOff } from 'lucide-react'
import { useId, useState } from 'react'
import { useForm, useWatch } from 'react-hook-form'
import { useNavigate } from 'react-router'
import { z } from 'zod'
import { ApiError } from '../api/http'
import { paths } from '../app/paths'
import { authCopy } from '../copy/auth'
import { srOnly } from '../lib/a11y'
import { fieldProps } from '../lib/forms'
import { useSession } from '../session/useSession'

const copy = authCopy.changePassword
const MIN = 12

const schema = z
  .object({ current: z.string(), next: z.string(), confirm: z.string() })
  .superRefine(({ current, next, confirm }, ctx) => {
    if (!current) ctx.addIssue({ code: 'custom', path: ['current'], message: copy.errors.currentRequired })
    if (!next) ctx.addIssue({ code: 'custom', path: ['next'], message: copy.errors.nextRequired })
    else if (Array.from(next).length < MIN) ctx.addIssue({ code: 'custom', path: ['next'], message: copy.errors.nextShort })
    else if (next === current) ctx.addIssue({ code: 'custom', path: ['next'], message: copy.errors.same })
    if (!confirm) ctx.addIssue({ code: 'custom', path: ['confirm'], message: copy.errors.confirmRequired })
    else if (next && confirm !== next) ctx.addIssue({ code: 'custom', path: ['confirm'], message: copy.errors.mismatch })
  })
type Values = z.infer<typeof schema>

// Nothing is met until something is typed.
const checkRules = (current: string, next: string) => [Array.from(next).length >= MIN, next.length > 0 && next !== current]

function RuleList({ id, rules }: { id: string; rules: boolean[] }) {
  const met = rules.filter(Boolean).length
  return (
    <>
      <Box component="ul" role="list" aria-label={copy.rulesLabel} sx={{ listStyle: 'none', p: 0, m: 0, mt: -1, display: 'grid', gap: 0.75 }}>
        {copy.rules.map((text, i) => {
          const ok = rules[i]
          const Icon = ok ? CircleCheck : Circle
          return (
            <Box component="li" key={text} id={`${id}-${i}`} sx={{ display: 'flex', alignItems: 'center', gap: 1, typography: 'body2', color: ok ? 'text.primary' : 'text.secondary' }}>
              <Box component="span" sx={{ display: 'flex', flexShrink: 0, color: ok ? status.success : neutral.inkTertiary }}>
                <Icon size={16} strokeWidth={1.5} aria-hidden="true" />
              </Box>
              <span>{text}</span>
              <Box component="span" sx={srOnly}>
                {ok ? copy.met : copy.notMet}
              </Box>
            </Box>
          )
        })}
      </Box>
      <Box role="status" sx={srOnly}>
        {copy.summary(met, rules.length)}
      </Box>
    </>
  )
}

// Reached after signing in with a temporary password: no sidebar until the admin has their own.
export default function ChangePassword() {
  const { admin, changePassword, signOut } = useSession()
  const navigate = useNavigate()
  const notify = useSnackbar()
  const [show, setShow] = useState(false)
  const [failure, setFailure] = useState<string | null>(null)
  const { register, handleSubmit, control, setError, formState } = useForm<Values>({ resolver: zodResolver(schema), defaultValues: { current: '', next: '', confirm: '' } })
  const [current, next] = useWatch({ control, name: ['current', 'next'] })
  const rules = checkRules(current, next)
  const nextId = useId()
  const rulesId = useId()
  const errors = formState.errors
  const firstName = admin?.display_name.trim().split(/\s+/)[0] ?? ''
  const type = show ? 'text' : 'password'

  const onSubmit = handleSubmit(async (values) => {
    setFailure(null)
    try {
      await changePassword(values.current, values.next)
      notify(copy.saved)
      navigate(paths.home, { replace: true })
    } catch (error) {
      if (error instanceof ApiError && error.fields.current_password) setError('current', { type: 'server', message: error.fields.current_password }, { shouldFocus: true })
      else if (error instanceof ApiError && error.fields.new_password) setError('next', { type: 'server', message: error.fields.new_password }, { shouldFocus: true })
      else setFailure(error instanceof ApiError ? error.message : copy.errors.generic)
    }
  })

  const toggle = (
    <InputAdornment position="end">
      <IconButton aria-label={show ? copy.hide : copy.show} onClick={() => setShow((s) => !s)} edge="end" sx={{ width: 44, height: 44 }}>
        {show ? <EyeOff size={18} strokeWidth={1.5} aria-hidden="true" /> : <Eye size={18} strokeWidth={1.5} aria-hidden="true" />}
      </IconButton>
    </InputAdornment>
  )

  return (
    <Box sx={{ minHeight: '100dvh', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', bgcolor: 'background.default', px: 2, py: { xs: 4, sm: 6 } }}>
      <Box sx={{ mb: 4 }}>
        <Logo product="One" />
      </Box>
      <Card component="main" sx={{ width: '100%', maxWidth: 440, p: { xs: 3, sm: 5 }, borderRadius: '12px' }}>
        <Typography variant="h1" component="h1" sx={{ fontFamily: fontFamily.display, fontSize: { xs: '1.75rem', sm: '2.25rem' }, fontWeight: 400, lineHeight: 1.15, textWrap: 'balance' }}>
          {copy.title}
        </Typography>
        <Typography variant="body1" color="text.secondary" sx={{ mt: 1.5, mb: 4 }}>
          {copy.subtitle(firstName)}
        </Typography>
        <Box component="form" noValidate onSubmit={onSubmit}>
          {/* Lets password managers save the new password against the right account. */}
          <input type="email" name="username" autoComplete="username" value={admin?.email ?? ''} readOnly hidden />
          <Stack spacing={2.5}>
            {failure && <Banner tone="error" title={failure} />}
            <TextField label={copy.current} type={type} autoComplete="current-password" {...fieldProps(register('current'), errors.current)} slotProps={{ htmlInput: { autoCapitalize: 'none', spellCheck: false } }} />
            <TextField
              id={nextId}
              label={copy.next}
              type={type}
              autoComplete="new-password"
              {...fieldProps(register('next'), errors.next)}
              slotProps={{
                htmlInput: { 'aria-describedby': [errors.next ? `${nextId}-helper-text` : null, ...copy.rules.map((_, i) => `${rulesId}-${i}`)].filter(Boolean).join(' '), autoCapitalize: 'none', spellCheck: false },
                input: { endAdornment: toggle },
              }}
            />
            <RuleList id={rulesId} rules={rules} />
            <TextField label={copy.confirm} type={type} autoComplete="new-password" {...fieldProps(register('confirm'), errors.confirm)} slotProps={{ htmlInput: { autoCapitalize: 'none', spellCheck: false } }} />
            <Button type="submit" variant="contained" size="large" fullWidth disabled={formState.isSubmitting} sx={{ minHeight: 44 }}>
              {formState.isSubmitting ? copy.submitting : copy.submit}
            </Button>
          </Stack>
        </Box>
        <Typography variant="body2" color="text.secondary" sx={{ mt: 3 }}>
          {copy.notYou}{' '}
          <Link component="button" type="button" variant="body2" onClick={() => void signOut().then(() => navigate(paths.signIn, { replace: true }))} sx={{ verticalAlign: 'baseline' }}>
            {copy.signOut}
          </Link>
        </Typography>
      </Card>
    </Box>
  )
}
