import { zodResolver } from '@hookform/resolvers/zod'
import { Box, Button, IconButton, InputAdornment, Stack, TextField, Typography } from '@mui/material'
import { Banner, brand, fontFamily, Logo } from '@shazlo/ui'
import { Eye, EyeOff, ShieldCheck, Store, Users } from 'lucide-react'
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
const ICONS = [Store, ShieldCheck, Users]

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
      <Box component="aside" aria-labelledby="one-pitch" sx={{ display: { xs: 'none', md: 'flex' }, width: '44%', maxWidth: 640, bgcolor: brand.navy, color: brand.offWhite, flexDirection: 'column', justifyContent: 'space-between', p: 7 }}>
        <Box sx={{ '& img': { filter: 'brightness(0) invert(0.97) sepia(0.15)' }, '& span': { color: brand.amber, borderColor: 'rgba(250, 182, 42, 0.6)' } }}>
          <Logo product="One" />
        </Box>
        <Box>
          <Typography id="one-pitch" component="h2" sx={{ fontFamily: fontFamily.display, fontSize: '2.75rem', lineHeight: 1.08, mb: 4, textWrap: 'balance' }}>
            {copy.pitch}
          </Typography>
          <Stack component="ul" spacing={2.5} sx={{ listStyle: 'none', p: 0, m: 0 }}>
            {copy.points.map((p, i) => {
              const Icon = ICONS[i]!
              return (
                <Stack component="li" key={p.title} direction="row" spacing={2}>
                  <Box sx={{ color: brand.amber, pt: '3px' }}><Icon size={20} strokeWidth={1.5} aria-hidden="true" /></Box>
                  <Box>
                    <Typography sx={{ fontFamily: fontFamily.display, fontSize: '1.0625rem' }}>{p.title}</Typography>
                    <Typography variant="body2" sx={{ color: 'rgba(255, 252, 227, 0.75)', mt: 0.25 }}>{p.body}</Typography>
                  </Box>
                </Stack>
              )
            })}
          </Stack>
        </Box>
        <Typography variant="caption" sx={{ color: 'rgba(255, 252, 227, 0.55)' }}>{copy.internal}</Typography>
      </Box>
      <Box component="main" sx={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', px: 2, py: 6 }}>
        <Box sx={{ width: '100%', maxWidth: 400 }}>
          <Box sx={{ display: { md: 'none' }, mb: 4 }}><Logo product="One" /></Box>
          <Typography variant="h1" component="h1" sx={{ fontFamily: fontFamily.display, fontSize: { xs: '1.75rem', sm: '2.25rem' }, fontWeight: 400, lineHeight: 1.15 }}>
            {copy.title}
          </Typography>
          <Typography variant="body1" color="text.secondary" sx={{ mt: 1.5, mb: 4 }}>{copy.subtitle}</Typography>
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
                slotProps={{ input: { endAdornment: <InputAdornment position="end"><IconButton aria-label={show ? copy.hide : copy.show} onClick={() => setShow((s) => !s)} edge="end">{show ? <EyeOff size={18} aria-hidden="true" /> : <Eye size={18} aria-hidden="true" />}</IconButton></InputAdornment> } }}
              />
              <Button type="submit" variant="contained" size="large" fullWidth disabled={formState.isSubmitting}>{formState.isSubmitting ? copy.submitting : copy.submit}</Button>
            </Stack>
          </Box>
          <Typography variant="body2" color="text.secondary" sx={{ mt: 3 }}>{copy.forgot}</Typography>
        </Box>
      </Box>
    </Box>
  )
}
