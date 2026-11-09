import { Box, Button, Card, Link, Skeleton, Stack, Tab, Tabs, Typography } from '@mui/material'
import { Banner, brand, EmptyState, neutral, PageHeader, StatusPill } from '@shazlo/ui'
import { ArrowLeft } from 'lucide-react'
import { useId, useState, type ReactNode } from 'react'
import { useWatch } from 'react-hook-form'
import { Link as RouterLink, useParams, useSearchParams } from 'react-router'
import { ApiError } from '../../api/http'
import { useVendor, useVendorAction } from '../../api/queries'
import type { components } from '../../api/schema'
import { modulePaths } from '../../app/routes'
import { vendorActionsCopy, vendorDetailCopy as copy } from '../../copy/vendors'
import { formatCount, formatDate } from '../../lib/format'
import { vendorPill } from '../../lib/status'
import { useModuleTitle, useRuntime } from '../../runtime/runtime'
import { ApplicationTab, ExternalLink } from './detail/ApplicationTab'
import { apiFieldToForm, toApproveBody, useApprovalForm, type ApprovalValues } from './detail/approval'
import { ActivityTab, BrandTab, ProductsTab } from './detail/OtherTabs'
import { VendorActionDialog, type DialogKind } from './dialogs'
import { isApplication } from './list/VendorTable'

type Vendor = components['schemas']['VendorDetail']
type Outcome = { tone: 'success' | 'error'; text: string }

const TABS = ['application', 'products', 'brand', 'activity'] as const
type TabKey = (typeof TABS)[number]
const isTab = (value: string | null): value is TabKey => TABS.includes(value as TabKey)
const DAY_MS = 86_400_000

function BackLink() {
  return (
    <Link component={RouterLink} to={modulePaths.vendors} underline="hover" sx={{ display: 'inline-flex', alignItems: 'center', gap: 0.5, mb: 1.5, color: neutral.inkSecondary, typography: 'body2' }}>
      <ArrowLeft size={16} strokeWidth={1.5} aria-hidden="true" />
      {copy.back}
    </Link>
  )
}

function DetailSkeleton() {
  return (
    <Box aria-busy="true">
      <Skeleton variant="text" width={80} sx={{ mb: 1.5 }} />
      <Skeleton variant="text" width={360} height={56} />
      <Skeleton variant="text" width={420} sx={{ mb: 4 }} />
      <Skeleton variant="rectangular" height={44} sx={{ mb: 3, borderRadius: 1 }} />
      <Stack direction={{ xs: 'column', md: 'row' }} spacing={3}>
        <Skeleton variant="rounded" height={360} sx={{ flex: 2 }} />
        <Skeleton variant="rounded" height={280} sx={{ flex: 1 }} />
      </Stack>
    </Box>
  )
}

// The last time the vendor entered its current state, for the rejected and suspended banners.
function lastEvent(vendor: Vendor, event: 'rejected' | 'suspended') {
  return vendor.history.find((h) => h.event === event)
}

function StateBanner({ vendor }: { vendor: Vendor }) {
  if (vendor.status !== 'rejected' && vendor.status !== 'suspended') return null
  const entry = lastEvent(vendor, vendor.status)
  const rejected = vendor.status === 'rejected'
  const title = entry ? (rejected ? copy.rejected.title : copy.suspended.title)(formatDate(entry.at), entry.by) : vendorPill[vendor.status].label
  return (
    <Banner tone="info" label={rejected ? copy.rejected.label : copy.suspended.label} title={title}>
      {entry?.note ? `“${entry.note}”` : copy.rejected.noReason}
    </Banner>
  )
}

function TabLabel({ text, count }: { text: string; count?: number }) {
  return (
    <span>
      {text}
      {count != null && (
        <>
          {' '}
          <Box component="span" sx={{ color: 'text.secondary', fontVariantNumeric: 'tabular-nums', ml: 0.25 }}>
            {formatCount(count)}
          </Box>
        </>
      )}
    </span>
  )
}

function VendorView({ vendor }: { vendor: Vendor }) {
  useModuleTitle(vendor.brand_name)
  const { toast } = useRuntime()
  const [search, setSearch] = useSearchParams()
  const requested = search.get('tab')
  const tab: TabKey = isTab(requested) ? requested : 'application'
  const tabsId = useId()
  const hintId = useId()
  const [outcome, setOutcome] = useState<Outcome | null>(null)
  // "Applied 2 days ago" is read once per visit, not on every render.
  const [now] = useState(() => Date.now())
  // Kept after closing (open: false) so the dialog keeps its words while it fades out.
  const [dialog, setDialog] = useState<{ kind: DialogKind; open: boolean } | null>(null)
  const closeDialog = () => setDialog((d) => d && { ...d, open: false })
  const approveAction = useVendorAction(vendor.id)
  const form = useApprovalForm(vendor)
  const agreement = useWatch({ control: form.control, name: 'agreement' })
  const { isValid } = form.formState

  const open = isApplication(vendor)
  const pill = vendorPill[vendor.status]
  const owner = vendor.owner_name
  const name = vendor.brand_name

  const selectTab = (next: TabKey) =>
    setSearch(
      (prev) => {
        const p = new URLSearchParams(prev)
        if (next === 'application') p.delete('tab')
        else p.set('tab', next)
        return p
      },
      { replace: true },
    )

  const approve = form.handleSubmit(async (values: ApprovalValues) => {
    setOutcome(null)
    try {
      await approveAction.mutateAsync({ action: 'approve', body: toApproveBody(values) })
      setOutcome({ tone: 'success', text: vendorActionsCopy.approve.banner(name, owner) })
      toast('success', vendorActionsCopy.approve.done(name))
    } catch (error) {
      const fields = error instanceof ApiError && error.status === 422 ? Object.entries(error.fields).filter(([key]) => key in apiFieldToForm) : []
      if (fields.length === 0) {
        setOutcome({ tone: 'error', text: error instanceof Error ? error.message : vendorActionsCopy.failed })
        return
      }
      if (tab !== 'application') selectTab('application')
      for (const [key, message] of fields) form.setError(apiFieldToForm[key]!, { type: 'server', message })
      const first = apiFieldToForm[fields[0]![0]]!
      requestAnimationFrame(() => form.setFocus(first))
    }
  })

  const onDone = (kind: DialogKind) => {
    closeDialog()
    const words = { suspend: vendorActionsCopy.suspend, reactivate: vendorActionsCopy.reactivate, reject: vendorActionsCopy.reject, 'request-info': vendorActionsCopy.requestInfo }[kind]
    setOutcome({ tone: 'success', text: words.banner(name, owner) })
    toast('success', words.done(name))
  }
  const onFailed = (_kind: DialogKind, error: Error) => {
    closeDialog()
    setOutcome({ tone: 'error', text: error.message || vendorActionsCopy.failed })
  }
  const ask = (kind: DialogKind) => {
    setOutcome(null)
    setDialog({ kind, open: true })
  }

  let actions: ReactNode = null
  if (open) {
    const blocked = !isValid
    actions = (
      <Stack spacing={0.75} sx={{ alignItems: { md: 'flex-end' } }}>
        <Stack direction="row" spacing={1.5} useFlexGap sx={{ flexWrap: 'wrap' }}>
          <Button variant="outlined" onClick={() => ask('request-info')}>
            {vendorActionsCopy.requestInfo.button}
          </Button>
          <Button variant="outlined" onClick={() => ask('reject')}>
            {vendorActionsCopy.reject.button}
          </Button>
          <Button variant="contained" onClick={() => void approve()} disabled={blocked || approveAction.isPending} aria-describedby={blocked ? hintId : undefined}>
            {approveAction.isPending ? vendorActionsCopy.approve.pending : vendorActionsCopy.approve.button}
          </Button>
        </Stack>
        {blocked && (
          <Typography id={hintId} variant="caption" color="text.secondary">
            {agreement ? vendorActionsCopy.approve.blockedFields : vendorActionsCopy.approve.blockedAgreement}
          </Typography>
        )}
      </Stack>
    )
  } else if (vendor.status === 'approved') {
    actions = (
      <Button variant="outlined" onClick={() => ask('suspend')}>
        {copy.actions.suspend}
      </Button>
    )
  } else if (vendor.status === 'suspended') {
    actions = (
      <Button variant="contained" onClick={() => ask('reactivate')}>
        {copy.actions.reactivate}
      </Button>
    )
  }

  const days = Math.max(0, Math.floor((now - Date.parse(vendor.application.applied_at)) / DAY_MS))
  const site = vendor.application.instagram_or_website
  const subtitle = (
    <>
      {`${copy.applied(days, formatDate(vendor.application.applied_at))} · ${vendor.city} · `}
      <ExternalLink href={site}>{site}</ExternalLink>
    </>
  )

  const tabs: { key: TabKey; text: string; count?: number }[] = [
    { key: 'application', text: copy.tabs.application },
    { key: 'products', text: copy.tabs.products, count: vendor.products.length },
    { key: 'brand', text: copy.tabs.brand },
    { key: 'activity', text: copy.tabs.activity, count: vendor.history.length },
  ]

  return (
    <>
      <BackLink />
      <PageHeader title={name} status={<StatusPill status={pill.status} label={pill.label} />} subtitle={subtitle} actions={actions} />
      <Stack spacing={3}>
        {outcome && (
          <Banner tone={outcome.tone} title={outcome.tone === 'success' ? outcome.text : vendorActionsCopy.failed} onClose={() => setOutcome(null)}>
            {outcome.tone === 'error' ? outcome.text : undefined}
          </Banner>
        )}
        <StateBanner vendor={vendor} />
        <Tabs
          value={tab}
          onChange={(_, next: TabKey) => selectTab(next)}
          aria-label={copy.tabsLabel}
          variant="scrollable"
          scrollButtons="auto"
          textColor="inherit"
          sx={{ borderBottom: `1px solid ${neutral.line}`, minHeight: 44, '& .MuiTabs-indicator': { bgcolor: brand.brown } }}
        >
          {tabs.map((t) => (
            <Tab
              key={t.key}
              value={t.key}
              id={`${tabsId}-tab-${t.key}`}
              aria-controls={`${tabsId}-panel-${t.key}`}
              label={<TabLabel text={t.text} count={t.count} />}
              sx={{ minHeight: 44, px: 2, color: 'text.secondary', '&.Mui-selected': { color: neutral.ink } }}
            />
          ))}
        </Tabs>
        <Box role="tabpanel" id={`${tabsId}-panel-${tab}`} aria-labelledby={`${tabsId}-tab-${tab}`}>
          {tab === 'application' && <ApplicationTab vendor={vendor} open={open} form={form} onApprove={(event) => void approve(event)} approving={approveAction.isPending} />}
          {tab === 'products' && <ProductsTab vendor={vendor} />}
          {tab === 'brand' && <BrandTab vendor={vendor} />}
          {tab === 'activity' && <ActivityTab vendor={vendor} />}
        </Box>
      </Stack>
      {dialog && <VendorActionDialog key={dialog.kind} vendor={vendor} kind={dialog.kind} open={dialog.open} onClose={closeDialog} onDone={onDone} onFailed={onFailed} />}
    </>
  )
}

function NotFound() {
  useModuleTitle(copy.notFoundTitle)
  return (
    <Card>
      <EmptyState
        illustration="box"
        title={copy.notFound.title}
        body={copy.notFound.body}
        action={
          <Button variant="outlined" component={RouterLink} to={modulePaths.vendors}>
            {copy.notFound.back}
          </Button>
        }
      />
    </Card>
  )
}

// A-09: one vendor or application: what they told us, the automatic checks, and the decision.
export default function VendorDetail() {
  const { id = '' } = useParams()
  const query = useVendor(id)

  if (query.data) return <VendorView key={query.data.id} vendor={query.data} />
  if (query.isError && query.error instanceof ApiError && query.error.status === 404) return <NotFound />
  if (query.isError) {
    return (
      <>
        <BackLink />
        <Banner
          tone="error"
          title={copy.error.title}
          action={
            <Button variant="outlined" size="small" onClick={() => void query.refetch()} disabled={query.isFetching}>
              {copy.error.retry}
            </Button>
          }
        >
          {query.error.message}
        </Banner>
      </>
    )
  }
  return <DetailSkeleton />
}
