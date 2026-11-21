import { Box, Checkbox, Chip, Divider, FormControl, FormControlLabel, FormHelperText, Grid, InputAdornment, Link, Stack, TextField, Typography } from '@mui/material'
import { radius, SectionCard, status, statusBackground } from '@shazlo/ui'
import { AlertTriangle, CheckCircle2 } from 'lucide-react'
import { useId, type FormEventHandler, type ReactNode } from 'react'
import type { UseFormReturn } from 'react-hook-form'
import type { components } from '../../../api/schema'
import { sellsLabel, vendorDetailCopy } from '../../../copy/vendors'
import { srOnly } from '../../../lib/a11y'
import { formatRate, waitingProposal } from '../../../lib/commission'
import { fieldProps, noAsterisk } from '../../../lib/forms'
import { useCompact } from '../../../lib/responsive'
import type { ApprovalValues } from './approval'
import { CommissionCard } from './CommissionCard'

const copy = vendorDetailCopy
const a = copy.application
type S = components['schemas']
type Vendor = S['VendorDetail']

const tabular = { fontVariantNumeric: 'tabular-nums' } as const

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
      <Typography component="dd" variant="body1" sx={{ m: 0, minWidth: 0, maxWidth: '68ch', overflowWrap: 'anywhere' }}>
        {children}
      </Typography>
    </>
  )
}

const NotGiven = () => (
  <Box component="span" sx={{ color: 'text.secondary' }}>
    {copy.notGiven}
  </Box>
)

// One topic of the sign-up (spec §5): a small heading over its answers.
function Topic({ title, children }: { title: string; children: ReactNode }) {
  const id = useId()
  return (
    <Box component="section" aria-labelledby={id}>
      <Typography id={id} variant="h3" component="h3" sx={{ mb: 1.25 }}>
        {title}
      </Typography>
      <Box component="dl" sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', sm: '180px 1fr' }, columnGap: 3, rowGap: { xs: 0.5, sm: 1.25 }, m: 0, '& dd': { mb: { xs: 1.25, sm: 0 } } }}>
        {children}
      </Box>
    </Box>
  )
}

// Agreed or not, in words and an icon.
function Agreed({ ok, children }: { ok: boolean; children?: string }) {
  const Icon = ok ? CheckCircle2 : AlertTriangle
  return (
    <Box component="span" sx={{ display: 'inline-flex', gap: 0.75, alignItems: 'flex-start' }}>
      <Box component="span" sx={{ color: ok ? status.success : status.error, display: 'flex', pt: '3px', flexShrink: 0 }}>
        <Icon size={16} strokeWidth={1.75} aria-hidden="true" />
      </Box>
      <span>{`${ok ? a.agreed : a.notAgreed}${children ? `. ${children}` : ''}`}</span>
    </Box>
  )
}

function DeliveryRows({ delivery }: { delivery: S['Delivery'] }) {
  if (delivery.by === 'shazlo') {
    const p = delivery.pickup_address
    return (
      <>
        <Row term={a.whoDelivers}>{a.shazloDelivery}</Row>
        <Row term={a.pickup}>{`${p.line}, ${p.area}, ${p.city} ${p.pin}`}</Row>
      </>
    )
  }
  return (
    <>
      <Row term={a.whoDelivers}>{a.ownDelivery}</Row>
      <Row term={a.areas}>
        {delivery.all_india ? (
          a.allIndia
        ) : (
          <Stack component="span" direction="row" useFlexGap sx={{ gap: 0.75, flexWrap: 'wrap' }}>
            {delivery.places.map((place) => (
              <Chip key={place} label={place} size="small" variant="outlined" component="span" />
            ))}
          </Stack>
        )}
      </Row>
      <Row term={a.deliveryTime}>{a.days[delivery.days]}</Row>
    </>
  )
}

function ReturnRows({ returns }: { returns: S['Returns'] }) {
  if (returns.window_days === 0) return <Row term={a.returnWindow}>{a.noReturns}</Row>
  return (
    <>
      <Row term={a.returnWindow}>{a.windowDays(returns.window_days)}</Row>
      {returns.condition && <Row term={a.condition}>{a.conditions[returns.condition]}</Row>}
      {returns.refund_days != null && <Row term={a.refund}>{a.refundDays(returns.refund_days)}</Row>}
    </>
  )
}

function PayoutRows({ payout }: { payout: S['Payout'] }) {
  if (payout.method === 'upi') {
    return (
      <>
        <Row term={a.payoutTo}>{a.upiId}</Row>
        <Row term={a.upiId}>{payout.upi_masked}</Row>
      </>
    )
  }
  return (
    <>
      <Row term={a.payoutTo}>{a.bankAccount}</Row>
      <Row term={a.account}>
        <Box component="span" sx={tabular}>{`${payout.bank_name} · ${a.masked(payout.account_last4)}`}</Box>
      </Row>
      <Row term={a.ifsc}>
        <Typography variant="mono" component="span" sx={{ fontSize: 14 }}>
          {payout.ifsc}
        </Typography>
      </Row>
      <Row term={a.accountHolder}>{payout.account_holder}</Row>
    </>
  )
}

function takes({ cash, upi }: S['Application']['pay_on_delivery']) {
  if (cash && upi) return a.cashAndUpi
  if (cash) return a.cashOnly
  return upi ? a.upiOnly : a.neither
}

// Everything the brand gave at sign-up, one topic at a time. Payout numbers come masked.
function ApplicationCard({ vendor }: { vendor: Vendor }) {
  const app = vendor.application
  return (
    <SectionCard title={a.title}>
      <Stack spacing={2.5} divider={<Divider flexItem />}>
        <Topic title={a.sections.brand}>
          <Row term={a.sells}>{sellsLabel[vendor.sells]}</Row>
          <Row term={a.shipsFrom}>{vendor.city}</Row>
          <Row term={a.link}>{app.instagram_or_website ? <ExternalLink href={app.instagram_or_website}>{app.instagram_or_website}</ExternalLink> : <NotGiven />}</Row>
        </Topic>
        <Topic title={a.sections.contact}>
          <Row term={a.name}>{vendor.owner_name}</Row>
          <Row term={a.mobile}>
            <Typography variant="mono" component="span" sx={{ fontSize: 14 }}>
              {vendor.phone}
            </Typography>
          </Row>
          <Row term={a.email}>{vendor.email}</Row>
        </Topic>
        <Topic title={a.sections.delivery}>
          <DeliveryRows delivery={app.delivery} />
        </Topic>
        <Topic title={a.sections.returns}>
          <ReturnRows returns={app.returns} />
        </Topic>
        <Topic title={a.sections.payment}>
          <Row term={a.takes}>{takes(app.pay_on_delivery)}</Row>
        </Topic>
        <Topic title={a.sections.payouts}>
          <PayoutRows payout={app.payout} />
        </Topic>
        <Topic title={a.sections.business}>
          <Row term={a.legalName}>{app.legal_name ?? <NotGiven />}</Row>
          <Row term={a.gst}>
            {app.gst_number ? (
              <Typography variant="mono" component="span" sx={{ fontSize: 14 }}>
                {app.gst_number}
              </Typography>
            ) : (
              <NotGiven />
            )}
          </Row>
          <Row term={a.proposed}>{app.proposed_commission_bps == null ? a.noProposal : <Box component="span" sx={tabular}>{formatRate(app.proposed_commission_bps)}</Box>}</Row>
          <Row term={a.terms}>
            <Agreed ok={app.agreed_terms} />
          </Row>
          <Row term={a.priceRule}>
            <Agreed ok={app.agreed_price_rule}>{a.priceRuleText}</Agreed>
          </Row>
        </Topic>
      </Stack>
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
                <Typography variant="body2" color="text.secondary" sx={{ overflowWrap: 'anywhere' }}>
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

// The rate is required and has no default: it starts from the brand's proposal, or empty.
function ApprovalCard({ vendor, form, onSubmit, disabled }: { vendor: Vendor; form: UseFormReturn<ApprovalValues>; onSubmit: FormEventHandler; disabled: boolean }) {
  const c = copy.approval
  const { register, formState } = form
  const { errors } = formState
  const agreementError = useId()
  const hintId = useId()
  const { ref: agreementRef, ...agreement } = register('agreement')
  const proposal = waitingProposal(vendor.commission)
  const rateHint = proposal == null ? c.noProposalHint : c.proposedHint(formatRate(proposal))
  return (
    <SectionCard title={c.title}>
      <Box component="form" noValidate onSubmit={onSubmit} aria-describedby={hintId}>
        <Stack spacing={2.5}>
          <TextField
            {...fieldProps(register('commission'), errors.commission, rateHint)}
            label={c.commission}
            required
            autoComplete="off"
            disabled={disabled}
            slotProps={{
              ...noAsterisk,
              htmlInput: { inputMode: 'decimal', style: tabular },
              input: { endAdornment: <InputAdornment position="end">%</InputAdornment> },
            }}
          />
          <TextField {...fieldProps(register('owner_email'), errors.owner_email)} label={c.email} type="email" autoComplete="off" required disabled={disabled} slotProps={noAsterisk} />
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

type Props = {
  vendor: Vendor
  open: boolean
  form: UseFormReturn<ApprovalValues>
  onApprove: FormEventHandler
  approving: boolean
  onCommissionDone: (banner: string, toast: string) => void
  onCommissionFailed: (error: Error) => void
}

export function ApplicationTab({ vendor, open, form, onApprove, approving, onCommissionDone, onCommissionFailed }: Props) {
  // One column below 900 px: phones, tablets, and a laptop beside the shell's sidebar.
  const oneColumn = useCompact()
  const brandOnShazlo = vendor.status === 'approved' || vendor.status === 'suspended'
  let side: ReactNode = null
  if (open) side = <ApprovalCard vendor={vendor} form={form} onSubmit={onApprove} disabled={approving} />
  // The header holds the page's primary button for a suspended brand (Reactivate).
  else if (brandOnShazlo) side = <CommissionCard vendor={vendor} primary={vendor.status !== 'suspended'} onDone={onCommissionDone} onFailed={onCommissionFailed} />

  // Keyed, so crossing 900 px (turning a tablet) moves the card rather than building a new one: an open
  // dialog, what was typed in it and a decision in flight all stay.
  const sideColumn = side && (
    <Grid key="side" size={{ xs: 12, md: 4 }}>
      <Box sx={{ position: { md: 'sticky' }, top: { md: 16 } }}>{side}</Box>
    </Grid>
  )
  // In one column a brand's commission comes first, above the long application; an application is
  // read before its approval settings.
  const commissionFirst = oneColumn && brandOnShazlo
  return (
    <Grid container spacing={3}>
      {commissionFirst && sideColumn}
      <Grid key="application" size={{ xs: 12, md: 8 }}>
        <Stack spacing={3}>
          <ApplicationCard vendor={vendor} />
          <ChecksCard checks={vendor.checks} />
        </Stack>
      </Grid>
      {!commissionFirst && sideColumn}
    </Grid>
  )
}
