import { zodResolver } from '@hookform/resolvers/zod'
import { Box, Button, Checkbox, Divider, FormControlLabel, IconButton, InputAdornment, Link, Stack, TextField, Typography } from '@mui/material'
import { Banner, brand, fontFamily } from '@shazlo/ui'
import { Eye, EyeOff, Layers, ShieldCheck, Wallet } from 'lucide-react'
import { useId, useState } from 'react'
import { useForm } from 'react-hook-form'
import { Link as RouterLink, useNavigate, useSearchParams } from 'react-router'
import { z } from 'zod'
import { ApiError } from '../../api/client'
import { paths } from '../../app/paths'
import { safeNext, useSession } from '../../auth/session'
import { authCopy } from '../../copy/auth'
import { AuthLayout, AuthTitle } from './AuthLayout'
import { fieldProps } from '../../lib/forms'

const copy = authCopy.signIn

const schema = z.object({
  identifier: z.string().trim().min(1, copy.errors.emailRequired).email(copy.errors.emailFormat),
  password: z.string().min(1, copy.errors.passwordRequired),
  remember: z.boolean(),
})
type Values = z.infer<typeof schema>

const ICONS = [Layers, ShieldCheck, Wallet]

function WhySell() {
  const id = useId()
  return (
    <Box component="aside" aria-labelledby={id} sx={{ maxWidth: 420 }}>
      <Typography variant="informal" sx={{ color: brand.brown, mb: 1 }}>
        {authCopy.why.tagline}
      </Typography>
      <Typography id={id} variant="h1" component="h2" sx={{ fontFamily: fontFamily.display, fontSize: '2.25rem', fontWeight: 400, lineHeight: 1.15, mb: 4 }}>
        {authCopy.why.title}
      </Typography>
      <Stack component="ul" spacing={3} sx={{ listStyle: 'none', p: 0, m: 0 }}>
        {authCopy.why.points.map((point, i) => {
          const Icon = ICONS[i]!
          return (
            <Stack component="li" key={point.title} direction="row" spacing={2}>
              <Box sx={{ color: brand.brown, pt: '3px', flexShrink: 0 }}>
                <Icon size={20} strokeWidth={1.5} aria-hidden="true" />
              </Box>
              <Box>
                <Typography variant="h3" component="h3">
                  {point.title}
                </Typography>
                <Typography variant="body1" color="text.secondary" sx={{ mt: 0.5 }}>
                  {point.body}
                </Typography>
              </Box>
            </Stack>
          )
        })}
      </Stack>
    </Box>
  )
}

export default function SignIn() {
  const { signIn } = useSession()
  const navigate = useNavigate()
  const [params] = useSearchParams()
  const [showPassword, setShowPassword] = useState(false)
  const [failure, setFailure] = useState<string | null>(null)
  const { register, handleSubmit, formState } = useForm<Values>({ resolver: zodResolver(schema), defaultValues: { identifier: '', password: '', remember: false } })

  const onSubmit = handleSubmit(async ({ identifier, password, remember }) => {
    setFailure(null)
    try {
      await signIn(identifier, password, remember)
      navigate(safeNext(params.get('next')), { replace: true })
    } catch (error) {
      setFailure(error instanceof ApiError ? error.message : 'Something went wrong. Try again.')
    }
  })

  return (
    <AuthLayout aside={<WhySell />}>
      <AuthTitle title={copy.title} subtitle={copy.subtitle} />
      <Box component="form" noValidate onSubmit={onSubmit}>
        <Stack spacing={2.5}>
          {failure && <Banner tone="error" title={failure} />}
          <TextField label={copy.email} type="email" autoComplete="username" inputMode="email" {...fieldProps(register('identifier'), formState.errors.identifier)} />
          <TextField
            label={copy.password}
            type={showPassword ? 'text' : 'password'}
            autoComplete="current-password"
            {...fieldProps(register('password'), formState.errors.password)}
            slotProps={{
              input: {
                endAdornment: (
                  <InputAdornment position="end">
                    <IconButton aria-label={showPassword ? copy.hidePassword : copy.showPassword} onClick={() => setShowPassword((s) => !s)} edge="end">
                      {showPassword ? <EyeOff size={18} aria-hidden="true" /> : <Eye size={18} aria-hidden="true" />}
                    </IconButton>
                  </InputAdornment>
                ),
              },
            }}
          />
          <Stack direction="row" sx={{ alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 1 }}>
            <FormControlLabel control={<Checkbox {...register('remember')} />} label={copy.remember} />
            <Link component={RouterLink} to={paths.forgotPassword}>
              {copy.forgot}
            </Link>
          </Stack>
          <Button type="submit" variant="contained" size="large" fullWidth disabled={formState.isSubmitting}>
            {formState.isSubmitting ? copy.submitting : copy.submit}
          </Button>
        </Stack>
      </Box>
      <Divider sx={{ my: 3 }} />
      <Typography variant="body1" color="text.secondary">
        {copy.newHere}{' '}
        <Link component={RouterLink} to={paths.apply}>
          {copy.apply}
        </Link>
      </Typography>
    </AuthLayout>
  )
}
