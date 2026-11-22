import { zodResolver } from '@hookform/resolvers/zod'
import { Box, Button, IconButton, InputAdornment, Stack, TextField, Typography } from '@mui/material'
import { Banner, brand, emphasis, Logo } from '@shazlo/ui'
import { ClipboardCheck, Eye, EyeOff, KeyRound, Store } from 'lucide-react'
import { useState } from 'react'
import { useForm } from 'react-hook-form'
import { useNavigate, useSearchParams } from 'react-router'
import { z } from 'zod'
import { ApiError } from '../api/http'
import { paths } from '../app/paths'
import { authCopy } from '../copy/auth'
import { fieldProps } from '../lib/forms'
import { safeNext } from '../session/guards'
import { useSession } from '../session/useSession'

const copy = authCopy.signIn
const schema = z.object({
  email: z.string().trim().min(1, copy.errors.emailRequired).email(copy.errors.emailFormat),
  password: z.string().min(1, copy.errors.passwordRequired),
})
type Values = z.infer<typeof schema>
// One plain outline icon per point: vendors, decisions on record, personal sign-ins.
const ICONS = [Store, ClipboardCheck, KeyRound]

// A-01 · navy brand panel beside the form (Shazlo One's chrome colour).
export default function SignIn() {
  const { signIn, reason } = useSession()
  const navigate = useNavigate()
  const [params] = useSearchParams()
  const [show, setShow] = useState(false)
  const [failure, setFailure] = useState<string | null>(null)
  const { register, handleSubmit, formState } = useForm<Values>({ resolver: zodResolver(schema), defaultValues: { email: '', password: '' } })

  const onSubmit = handleSubmit(async ({ email, password }) => {
    setFailure(null)
    try {
      const session = await signIn(email, password)
      navigate(session.must_change_password ? paths.changePassword : safeNext(params.get('next')), { replace: true })
    } catch (error) {
      setFailure(error instanceof ApiError ? error.message : copy.errors.generic)
    }
  })

  return (
    <Box sx={{ minHeight: '100dvh', display: 'flex', bgcolor: 'background.default' }}>
      <Box component="aside" aria-labelledby="one-pitch" sx={{ display: { xs: 'none', md: 'flex' }, width: '44%', maxWidth: 640, bgcolor: brand.navy, color: brand.offWhite, flexDirection: 'column', p: 7 }}>
        <Box>
          <Logo product="One" tone="amber" />
        </Box>
        {/* The pitch sits in the middle of the panel, under the logo. */}
        <Box sx={{ my: 'auto', pt: 6 }}>
          <Typography id="one-pitch" component="h2" sx={{ ...emphasis.semibold, fontSize: '2.75rem', lineHeight: 1.08, letterSpacing: '-0.02em', mb: 5, textWrap: 'balance' }}>
            {copy.pitch}
          </Typography>
          <Stack component="ul" spacing={3} sx={{ listStyle: 'none', p: 0, m: 0, maxWidth: '44ch' }}>
            {copy.points.map((p, i) => {
              const Icon = ICONS[i]!
              return (
                <Stack component="li" key={p.title} direction="row" spacing={2}>
                  <Box sx={{ display: 'flex', flexShrink: 0, color: brand.amber, pt: '2px' }}>
                    <Icon size={20} strokeWidth={1.75} aria-hidden="true" />
                  </Box>
                  <Box>
                    <Typography sx={{ ...emphasis.semibold, fontSize: '1.0625rem', lineHeight: 1.35 }}>{p.title}</Typography>
                    <Typography variant="body2" sx={{ color: 'rgba(255, 252, 227, 0.78)', mt: 0.5 }}>{p.body}</Typography>
                  </Box>
                </Stack>
              )
            })}
          </Stack>
        </Box>
      </Box>
      <Box component="main" sx={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', px: 2, py: 6 }}>
        <Box sx={{ width: '100%', maxWidth: 400 }}>
          <Box sx={{ display: { md: 'none' }, mb: 4 }}><Logo product="One" tone="navy" /></Box>
          <Typography variant="h1" component="h1" sx={{ ...emphasis.semibold, fontSize: { xs: '1.75rem', sm: '2.25rem' }, lineHeight: 1.15 }}>
            {copy.title}
          </Typography>
          <Typography variant="body1" color="textSecondary" sx={{ mt: 1.5, mb: 4 }}>{copy.subtitle}</Typography>
          <Box component="form" noValidate onSubmit={onSubmit}>
            <Stack spacing={2.5}>
              {reason === 'expired' && !failure && <Banner tone="info" title={copy.expired} />}
              {failure && <Banner tone="error" title={failure} />}
              <TextField label={copy.email} type="email" autoComplete="username" {...fieldProps(register('email'), formState.errors.email)} />
              <TextField
                label={copy.password}
                type={show ? 'text' : 'password'}
                autoComplete="current-password"
                {...fieldProps(register('password'), formState.errors.password)}
                slotProps={{ input: { endAdornment: <InputAdornment position="end"><IconButton aria-label={show ? copy.hide : copy.show} onClick={() => setShow((s) => !s)} edge="end">{show ? <EyeOff size={18} strokeWidth={1.75} aria-hidden="true" /> : <Eye size={18} strokeWidth={1.75} aria-hidden="true" />}</IconButton></InputAdornment> } }}
              />
              <Button type="submit" variant="contained" size="large" fullWidth disabled={formState.isSubmitting}>{formState.isSubmitting ? copy.submitting : copy.submit}</Button>
            </Stack>
          </Box>
          <Typography variant="body2" color="textSecondary" sx={{ mt: 3 }}>
            <Box component="strong" sx={{ ...emphasis.semibold, color: 'text.primary' }}>{copy.forgot}</Box>{' '}
            {copy.forgotHelp}
          </Typography>
        </Box>
      </Box>
    </Box>
  )
}
