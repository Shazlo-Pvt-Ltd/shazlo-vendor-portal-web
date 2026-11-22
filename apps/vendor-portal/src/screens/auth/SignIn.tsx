import { zodResolver } from '@hookform/resolvers/zod'
import { Box, Button, Divider, Link, Stack, TextField, Typography } from '@mui/material'
import { alpha } from '@mui/material/styles'
import { Banner, brand, emphasis } from '@shazlo/ui'
import { Layers, ShieldCheck, Wallet } from 'lucide-react'
import { useEffect, useId, useState } from 'react'
import { useForm } from 'react-hook-form'
import { Link as RouterLink, useLocation, useNavigate } from 'react-router'
import { z } from 'zod'
import { paths } from '../../app/paths'
import denimJacket from '../../assets/signin/denim-jacket.jpg'
import denimSet from '../../assets/signin/denim-set.jpg'
import greenCoord from '../../assets/signin/green-coord.jpg'
import indigoTunic from '../../assets/signin/indigo-tunic.jpg'
import offshoulderTop from '../../assets/signin/offshoulder-top.jpg'
import yellowShirt from '../../assets/signin/yellow-shirt.jpg'
import { authCopy } from '../../copy/auth'
import { frameCopy } from '../../copy/frame'
import { srOnly } from '../../lib/a11y'
import { fieldProps } from '../../lib/forms'
import { PasswordField } from '../../security/PasswordField'
import { registerSensitiveReset } from '../../security/sensitiveState'
import { useCountdown } from '../../session/useCountdown'
import { useLogin } from '../../session/useLogin'
import { AuthLayout, AuthTitle } from './AuthLayout'

const copy = authCopy.signIn
// The longest address vendor-api accepts.
const EMAIL_MAX = 320

const schema = z.object({
  email: z.string().trim().min(1, copy.errors.emailRequired).max(EMAIL_MAX, copy.errors.emailFormat).email(copy.errors.emailFormat),
  password: z.string().min(1, copy.errors.passwordRequired),
})
type Values = z.infer<typeof schema>

const ICONS = [Layers, ShieldCheck, Wallet]

// Placeholder photos for the collage (see src/assets/signin/README.md): three staggered columns,
// tilted like the app's welcome screen.
const COLUMNS = [
  [denimSet, indigoTunic, greenCoord],
  [yellowShirt, offshoulderTop, denimJacket],
  [greenCoord, denimSet, indigoTunic],
]

function Collage() {
  return (
    <Box
      data-collage=""
      aria-hidden="true"
      sx={{ position: 'absolute', top: '-18%', bottom: '-18%', left: '-22%', right: '-22%', display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 2, transform: 'rotate(-9deg)', pointerEvents: 'none' }}
    >
      {COLUMNS.map((photos, column) => (
        <Stack key={column} spacing={2} sx={{ mt: column === 1 ? '-14%' : column === 2 ? '9%' : 0 }}>
          {photos.map((src, i) => (
            <Box
              key={i}
              component="img"
              src={src}
              alt=""
              loading="lazy"
              decoding="async"
              draggable={false}
              sx={{ display: 'block', width: '100%', aspectRatio: '3 / 4', objectFit: 'cover', borderRadius: '16px', border: `1px solid ${alpha(brand.offWhite, 0.18)}` }}
            />
          ))}
        </Stack>
      ))}
    </Box>
  )
}

// The panel beside the form: the collage, a navy scrim that deepens towards the words, and the
// reasons in light type on top of it.
function WhySell() {
  const id = useId()
  const soft = alpha(brand.offWhite, 0.86)
  return (
    <Box data-panel="why-sell" sx={{ position: 'absolute', inset: 0, overflow: 'hidden', bgcolor: brand.navy }}>
      <Collage />
      <Box
        data-scrim=""
        aria-hidden="true"
        sx={{ position: 'absolute', inset: 0, background: `linear-gradient(180deg, ${alpha(brand.navy, 0.15)} 0%, ${alpha(brand.navy, 0.45)} 45%, ${alpha(brand.navy, 0.75)} 100%)` }}
      />
      <Box
        component="aside"
        aria-labelledby={id}
        sx={{ position: 'absolute', left: 0, right: 0, bottom: 0, zIndex: 1, maxHeight: '100%', overflowY: 'auto', boxSizing: 'border-box', px: 7, pt: 14, pb: 8, color: brand.offWhite, textShadow: `0 1px 2px ${alpha(brand.ink, 0.35)}`, background: `linear-gradient(0deg, ${brand.navy} 0%, ${alpha(brand.navy, 0.94)} 62%, ${alpha(brand.navy, 0)} 100%)`, '& > *': { maxWidth: 460 }, '@media (max-height: 760px)': { pt: 6, pb: 5, '& h2': { fontSize: '2rem', mb: 2.5 }, '& ul > li + li': { mt: 2 } } }}
      >
        <Typography variant="informal" sx={{ color: brand.amber, mb: 1, fontSize: '1.25rem' }}>
          {authCopy.why.tagline}
        </Typography>
        <Typography id={id} variant="display2" component="h2" sx={{ fontSize: '2.5rem', lineHeight: 1.1, mb: 4, color: brand.offWhite }}>
          {authCopy.why.title}
        </Typography>
        <Stack component="ul" spacing={3} sx={{ listStyle: 'none', p: 0, m: 0 }}>
          {authCopy.why.points.map((point, i) => {
            const Icon = ICONS[i]!
            return (
              <Stack component="li" key={point.title} direction="row" spacing={2}>
                <Box sx={{ color: brand.amber, bgcolor: alpha(brand.amber, 0.16), border: `1px solid ${alpha(brand.amber, 0.4)}`, borderRadius: '50%', width: 40, height: 40, display: 'grid', placeItems: 'center', flexShrink: 0 }}>
                  <Icon size={20} strokeWidth={1.75} aria-hidden="true" />
                </Box>
                <Box>
                  <Typography variant="h3" component="h3" sx={{ ...emphasis.semibold, fontSize: '1.0625rem', color: brand.offWhite }}>
                    {point.title}
                  </Typography>
                  <Typography variant="body1" sx={{ mt: 0.5, color: soft }}>
                    {point.body}
                  </Typography>
                </Box>
              </Stack>
            )
          })}
        </Stack>
      </Box>
    </Box>
  )
}

/**
 * V-01. Signs in through the session (src/session): the access token stays in memory and the
 * refresh cookie keeps the seller signed in, so there is no "keep me signed in". Once signed in,
 * the `PublicOnly` guard sends the seller to `?next` (checked by safeReturnTo) or Home. The
 * password leaves the form the moment it is sent.
 */
export default function SignIn() {
  const login = useLogin()
  const location = useLocation()
  const navigate = useNavigate()
  const countdown = useCountdown()
  const [failure, setFailure] = useState<string | null>(null)
  const { register, handleSubmit, formState, setValue, setFocus } = useForm<Values>({ resolver: zodResolver(schema), defaultValues: { email: '', password: '' } })
  const expired = (location.state as { expired?: boolean } | null)?.expired === true

  // A typed password never outlives the session that ends (sign-out in another tab, for one).
  useEffect(() => registerSensitiveReset(() => setValue('password', '')), [setValue])

  const onSubmit = handleSubmit(async ({ email, password }) => {
    if (countdown.active) return
    setFailure(null)
    setValue('password', '')
    const result = await login.submit(email, password)
    if (result.ok) return
    if (result.reason === 'blocked') {
      // The explanation page lives behind the signed-in guard; it never loops back here.
      void navigate(paths.overview, { replace: true })
      return
    }
    // "Too many attempts" is said once, by the countdown; anything else by the error banner.
    if (result.retryAfter) countdown.start(result.retryAfter)
    else setFailure(result.message)
    setFocus('password')
  })

  const busy = formState.isSubmitting || login.pending
  return (
    <AuthLayout aside={<WhySell />}>
      <AuthTitle title={copy.title} subtitle={copy.subtitle} />
      <Box component="form" noValidate onSubmit={onSubmit}>
        <Stack spacing={2.5}>
          {expired && !failure && <Banner tone="info" title={frameCopy.sessionEnded} />}
          {failure && <Banner tone="error" title={failure} />}
          {countdown.active && (
            <Banner
              tone="warning"
              title={
                <>
                  <Box component="span" sx={srOnly}>
                    {copy.waitAnnounced}
                  </Box>
                  <span aria-hidden="true">{copy.wait(countdown.remaining)}</span>
                </>
              }
            />
          )}
          <TextField label={copy.email} type="email" autoComplete="username" inputMode="email" {...fieldProps(register('email'), formState.errors.email)} />
          <PasswordField purpose="current" label={copy.password} {...fieldProps(register('password'), formState.errors.password)} />
          <Stack direction="row" sx={{ alignItems: 'center', justifyContent: 'flex-end', flexWrap: 'wrap', gap: 1 }}>
            <Link component={RouterLink} to={paths.forgotPassword} sx={{ display: 'inline-flex', alignItems: 'center', minHeight: 44 }}>
              {copy.forgot}
            </Link>
          </Stack>
          <Button type="submit" variant="contained" size="large" fullWidth disabled={busy || countdown.active}>
            {busy ? copy.submitting : copy.submit}
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
