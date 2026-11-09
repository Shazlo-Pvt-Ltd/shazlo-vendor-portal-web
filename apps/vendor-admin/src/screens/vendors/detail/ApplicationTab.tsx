import { Box, Checkbox, Chip, FormControl, FormControlLabel, FormHelperText, Grid, Link, Stack, TextField, Typography } from '@mui/material'
import { radius, SectionCard, status, statusBackground } from '@shazlo/ui'
import { AlertTriangle, CheckCircle2 } from 'lucide-react'
import { useId, type FormEventHandler, type ReactNode } from 'react'
import type { UseFormReturn } from 'react-hook-form'
import type { components } from '../../../api/schema'
import { vendorDetailCopy } from '../../../copy/vendors'
import { srOnly } from '../../../lib/a11y'
import { formatINR } from '../../../lib/format'
import { fieldProps } from '../../../lib/forms'
import { formatCommission } from '../list/csv'
import type { ApprovalValues } from './approval'

const copy = vendorDetailCopy
type Vendor = components['schemas']['VendorDetail']

export const siteHref = (site: string) => (/^https?:\/\//i.test(site) ? site : `https://${site}`)

export function ExternalLink({ href, children }: { href: string; children: ReactNode }) {
  return (
    <Link href={siteHref(href)} target="_blank" rel="noopener noreferrer" sx={{ overflowWrap: 'anywhere' }}>
      {children}
      <Box component="span" sx={srOnly}>
        {' '}
        {copy.opensInNewTab}
      </Box>
    </Link>
  )
}

function Row({ term, children }: { term: string; children: ReactNode }) {
  return (
    <>
      <Typography component="dt" variant="body2" color="text.secondary" sx={{ pt: '1px' }}>
        {term}
      </Typography>
      <Typography component="dd" variant="body1" sx={{ m: 0, minWidth: 0, maxWidth: '68ch' }}>
        {children}
      </Typography>
    </>
  )
}

function ApplicationCard({ vendor }: { vendor: Vendor }) {
  const a = vendor.application
  const c = copy.application
  return (
    <SectionCard title={c.title}>
      <Box component="dl" sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', sm: '180px 1fr' }, columnGap: 3, rowGap: { xs: 0.5, sm: 1.75 }, m: 0, '& dd': { mb: { xs: 1.5, sm: 0 } } }}>
        <Row term={c.owner}>{vendor.owner_name}</Row>
        <Row term={c.email}>{vendor.email}</Row>
        <Row term={c.phone}>
          <Typography variant="mono" component="span" sx={{ fontSize: 14 }}>
            {vendor.phone}
          </Typography>
        </Row>
        <Row term={c.city}>{vendor.city}</Row>
        <Row term={c.link}>
          <ExternalLink href={a.instagram_or_website}>{a.instagram_or_website}</ExternalLink>
        </Row>
        <Row term={c.sells}>
          <Stack direction="row" useFlexGap sx={{ gap: 0.75, flexWrap: 'wrap' }}>
            {a.product_types.map((type) => (
              <Chip key={type} label={type} size="small" variant="outlined" />
            ))}
          </Stack>
        </Row>
        <Row term={c.price}>
          <Box component="span" sx={{ fontVariantNumeric: 'tabular-nums' }}>{`${formatINR(a.price_min_paise)} – ${formatINR(a.price_max_paise)}`}</Box>
        </Row>
        <Row term={c.about}>{a.about}</Row>
      </Box>
    </SectionCard>
  )
}

// Each check says passed or needs a look in words and an icon; a failing one is tinted.
function ChecksCard({ checks }: { checks: Vendor['checks'] }) {
  const failing = checks.filter((check) => !check.ok).length
  return (
    <SectionCard
      title={copy.checks.title}
      action={
        <Typography variant="body2" sx={{ color: failing ? status.error : 'text.secondary' }}>
          {failing ? copy.checks.needLook(failing) : copy.checks.allPassed}
        </Typography>
      }
    >
      <Stack component="ul" spacing={0.5} sx={{ listStyle: 'none', p: 0, m: 0 }}>
        {checks.map((check) => {
          const Icon = check.ok ? CheckCircle2 : AlertTriangle
          return (
            <Stack
              key={check.label}
              component="li"
              direction="row"
              spacing={1.5}
              data-state={check.ok ? 'pass' : 'fail'}
              sx={{ alignItems: 'flex-start', py: 1, px: 1.5, mx: -1.5, borderRadius: `${radius.card}px`, bgcolor: check.ok ? undefined : statusBackground.error }}
            >
              <Box component="span" sx={{ color: check.ok ? status.success : status.error, display: 'flex', pt: '2px', flexShrink: 0 }}>
                <Icon size={18} strokeWidth={1.75} aria-hidden="true" />
              </Box>
              <Box sx={{ minWidth: 0 }}>
                <Box component="span" sx={srOnly}>
                  {check.ok ? copy.checks.passed : copy.checks.failed}
                </Box>
                <Typography variant="body1">{check.label}</Typography>
                <Typography variant="body2" color="text.secondary">
                  {check.note}
                </Typography>
              </Box>
            </Stack>
          )
        })}
      </Stack>
    </SectionCard>
  )
}

function ApprovalCard({ form, onSubmit, disabled }: { form: UseFormReturn<ApprovalValues>; onSubmit: FormEventHandler; disabled: boolean }) {
  const c = copy.approval
  const { register, formState } = form
  const { errors } = formState
  const agreementError = useId()
  const hintId = useId()
  const { ref: agreementRef, ...agreement } = register('agreement')
  return (
    <SectionCard title={c.title}>
      <Box component="form" noValidate onSubmit={onSubmit} aria-describedby={hintId}>
        <Stack spacing={2.5}>
          <TextField
            {...fieldProps(register('commission'), errors.commission, c.commissionHint)}
            label={c.commission}
            type="number"
            required
            disabled={disabled}
            slotProps={{ htmlInput: { min: 0, max: 40, step: 0.5, inputMode: 'decimal' } }}
          />
          <TextField {...fieldProps(register('owner_email'), errors.owner_email)} label={c.email} type="email" autoComplete="off" required disabled={disabled} />
          <FormControl error={Boolean(errors.agreement)}>
            <FormControlLabel
              control={
                <Checkbox
                  {...agreement}
                  disabled={disabled}
                  // MUI 9 takes the input's ref through its slot; RHF focuses it on an error.
                  slotProps={{ input: { ref: agreementRef, 'aria-invalid': Boolean(errors.agreement), 'aria-describedby': errors.agreement ? agreementError : undefined } as object }}
                />
              }
              label={c.agreement}
            />
            {errors.agreement && <FormHelperText id={agreementError}>{errors.agreement.message}</FormHelperText>}
          </FormControl>
          <Typography id={hintId} variant="body2" color="text.secondary">
            {c.hint}
          </Typography>
        </Stack>
      </Box>
    </SectionCard>
  )
}

function TermsCard({ vendor }: { vendor: Vendor }) {
  return (
    <SectionCard title={copy.terms.title}>
      <Stack direction="row" sx={{ justifyContent: 'space-between', alignItems: 'baseline' }}>
        <Typography variant="body2" color="text.secondary">
          {copy.terms.commission}
        </Typography>
        <Typography variant="body1" sx={{ fontVariantNumeric: 'tabular-nums' }}>
          {formatCommission(vendor.commission_bps)}
        </Typography>
      </Stack>
    </SectionCard>
  )
}

type Props = { vendor: Vendor; open: boolean; form: UseFormReturn<ApprovalValues>; onApprove: FormEventHandler; approving: boolean }

export function ApplicationTab({ vendor, open, form, onApprove, approving }: Props) {
  const showTerms = vendor.status === 'approved' || vendor.status === 'suspended'
  return (
    <Grid container spacing={3}>
      <Grid size={{ xs: 12, md: 8 }}>
        <Stack spacing={3}>
          <ApplicationCard vendor={vendor} />
          <ChecksCard checks={vendor.checks} />
        </Stack>
      </Grid>
      {(open || showTerms) && (
        <Grid size={{ xs: 12, md: 4 }}>
          <Box sx={{ position: { md: 'sticky' }, top: { md: 16 } }}>{open ? <ApprovalCard form={form} onSubmit={onApprove} disabled={approving} /> : <TermsCard vendor={vendor} />}</Box>
        </Grid>
      )}
    </Grid>
  )
}

