// A-09 · Vendor application: decide on a new vendor (flow V1 / A1). For an approved vendor the same
// page shows their products, brand page and activity, and offers Suspend.
import { Fragment, useEffect, useRef, useState, type ReactNode } from 'react'
import { useParams } from 'react-router'
import {
  Banner, Button, Card, Checkbox, EmptyState, Icon, kit, PageHeader, Rule, Tabs, Text, TextInput, TextLink,
} from '@shazlo/ui/components'
import {
  ApiError, useApproveVendor, useOpenApplication, useQueue, useReactivateVendor, useRejectVendor, useRequestInfo, useVendor,
  type ActivityEntry, type Vendor,
} from '../../api'
import { useModuleTitle, useShell } from '../../app/shell'
import { itemPath, plural } from '../shared/format'
import { ReasonDialog, type ReasonTemplate } from '../shared/ReasonDialog'
import { BackLink, ErrorCard, LoadingDetail, Screen } from '../shared/ui'
import { needsDecision, SuspendDialog, VendorStatusBadge } from './shared'

type Tab = 'application' | 'products' | 'brand' | 'activity'

const INFO_TEMPLATES: ReasonTemplate[] = [
  { label: 'Product photos', text: 'Please share photos of 3 products you plan to list.' },
  { label: 'Price list', text: 'Please share a price list for the products you plan to sell on Shazlo.' },
  { label: 'Studio address', text: 'Please share the address you will ship from, with a photo of your studio or shop.' },
]

const REJECT_TEMPLATES: ReasonTemplate[] = [
  { label: 'Outside the launch area', text: 'Shazlo only works with vendors in and around Ahmedabad for now. We’ll write when we reach your city.' },
  { label: 'Not handmade or small-batch', text: 'Shazlo lists handmade and small-batch labels, and these products don’t fit that yet.' },
  { label: 'Duplicate application', text: 'This brand already has an application or account with us, so we’ve closed this one.' },
  { label: 'Not enough products', text: 'We need at least 10 products ready to list. Please apply again when you have them.' },
  { label: 'Other' },
]

const capitalised = (list: string[]) => list.map((c, i) => (i === 0 ? c[0]!.toUpperCase() + c.slice(1) : c)).join(', ')
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

/* ---------- Pieces ---------- */

function DetailRows({ rows }: { rows: Array<[string, ReactNode]> }) {
  return (
    <Card pad="5px 19px" gap={0}>
      <dl style={{ margin: 0 }}>
      {rows.map(([label, value], i) => (
        <Fragment key={label}>
          {i > 0 && <Rule />}
          <div style={{ display: 'flex', gap: 16, padding: '10px 0', flexWrap: 'wrap' }}>
            <Text v="small" tone="muted" as="dt" style={{ width: 150, flexShrink: 0 }}>{label}</Text>
            <Text v="small" as="dd" style={{ margin: 0, flex: '1 1 240px', minWidth: 0, overflowWrap: 'anywhere' }}>{value}</Text>
          </div>
        </Fragment>
      ))}
      </dl>
    </Card>
  )
}

function ActivityList({ entries }: { entries: ActivityEntry[] }) {
  return (
    <ol style={{ listStyle: 'none', margin: 0, padding: 0, display: 'flex', flexDirection: 'column', gap: 12 }}>
      {entries.map((a, i) => (
        <li key={`${a.title}-${a.at}-${i}`} style={{ display: 'flex', gap: 10 }}>
          <span aria-hidden style={{ width: 8, height: 8, borderRadius: 4, background: kit.ink, marginTop: 5, flexShrink: 0 }} />
          <div style={{ display: 'flex', flexDirection: 'column', gap: 2, minWidth: 0, flex: 1 }}>
            <Text v="label">{a.title}</Text>
            <Text v="caption" tone="subtle">{a.at}</Text>
            {a.quote && <Text v="small" tone="muted" as="p">{a.quote}</Text>}
            {a.transition && <Text v="mono" tone="muted">{a.transition}</Text>}
          </div>
        </li>
      ))}
    </ol>
  )
}

function ActivityCard({ vendor, limit }: { vendor: Vendor; limit?: number }) {
  return (
    <Card pad={20} gap={12}>
      <Text v="title" as="h2">Activity</Text>
      <ActivityList entries={limit ? vendor.activity.slice(0, limit) : vendor.activity} />
    </Card>
  )
}

function useApprovalSettings({ vendor, onApproved }: { vendor: Vendor; onApproved: () => void }) {
  const { toast } = useShell()
  const approve = useApproveVendor()
  const [commission, setCommission] = useState('15%')
  const [login, setLogin] = useState(vendor.email)
  const [agreement, setAgreement] = useState(false)
  const [errors, setErrors] = useState<{ commission?: string; login?: string }>({})
  const commissionRef = useRef<HTMLInputElement>(null)
  const loginRef = useRef<HTMLInputElement>(null)

  const submit = () => {
    const pct = Number.parseFloat(commission.replace('%', '').trim())
    const next: typeof errors = {}
    if (!Number.isFinite(pct) || pct < 0 || pct > 50) next.commission = 'Enter a rate between 0% and 50%.'
    if (!EMAIL.test(login.trim())) next.login = 'Enter the owner’s email, like name@brand.in.'
    setErrors(next)
    if (next.commission) { commissionRef.current?.focus(); return }
    if (next.login) { loginRef.current?.focus(); return }
    approve.mutate({ id: vendor.id, commissionPct: pct, ownerLogin: login.trim() }, {
      onSuccess: v => { toast('success', `${v.brand} approved. Invite sent to ${login.trim()}.`); onApproved() },
      onError: e => {
        if (e instanceof ApiError && e.code === 'conflict') { setErrors({ login: e.message }); loginRef.current?.focus() }
        toast('error', e.message)
      },
    })
  }

  return {
    submit,
    pending: approve.isPending,
    agreement,
    card: (
      <Card pad={20} gap={14}>
        <Text v="title" as="h2">Approval settings</Text>
        <TextInput
          ref={commissionRef}
          label="Commission"
          inputMode="decimal"
          value={commission}
          onChange={e => setCommission(e.target.value)}
          onBlur={() => { const n = Number.parseFloat(commission.replace('%', '')); if (Number.isFinite(n)) setCommission(`${n}%`) }}
          helper="Pilot rate. Changes apply to future orders only."
          error={errors.commission}
        />
        <TextInput
          ref={loginRef}
          label="Owner login"
          type="email"
          autoComplete="off"
          value={login}
          onChange={e => setLogin(e.target.value)}
          helper="From the application. The invite goes here."
          error={errors.login}
        />
        <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
          <Checkbox label="Vendor agreement signed (offline)" checked={agreement} onChange={e => setAgreement(e.target.checked)} />
          {!agreement && <Text v="caption" tone="subtle" id="agreement-hint" style={{ paddingLeft: 24 }}>Approval unlocks once the signed agreement is in.</Text>}
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 4, padding: '10px 12px', background: kit.chip, borderRadius: 6 }}>
          <Text v="caption" tone="muted">On approval</Text>
          <Text v="small" as="p">Status becomes approved, the owner login is created and an invite goes out by email and WhatsApp. The link expires in 7 days.</Text>
        </div>
      </Card>
    ),
  }
}

function VendorSettings({ vendor }: { vendor: Vendor }) {
  return (
    <Card pad={20} gap={14}>
      <Text v="title" as="h2">Vendor settings</Text>
      {[
        ['Commission', vendor.commissionPct === null ? '—' : `${vendor.commissionPct}% · applies to new orders`],
        ['Owner login', vendor.ownerLogin ?? '—'],
        ['Live products', vendor.liveCount === null ? '—' : String(vendor.liveCount)],
      ].map(([label, value]) => (
        <div key={label} style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
          <Text v="caption" tone="subtle">{label}</Text>
          <Text v="small">{value}</Text>
        </div>
      ))}
    </Card>
  )
}

function ProductsTab({ vendor }: { vendor: Vendor }) {
  const queue = useQueue()
  const waiting = (queue.data?.items ?? []).filter(i => i.vendorId === vendor.id && i.kind === 'product')
  if (!vendor.liveCount && waiting.length === 0) {
    return (
      <Card pad={0}>
        <EmptyState icon="package" title="No products yet">
          {needsDecision(vendor) || vendor.status === 'rejected'
            ? `${vendor.brand} can add products once approved and signed in.`
            : `Nothing live or waiting. ${vendor.brand} adds products from the vendor portal.`}
        </EmptyState>
      </Card>
    )
  }
  return (
    <Card pad={20} gap={12}>
      <Text v="title" as="h2">{plural(vendor.liveCount ?? 0, 'live product')} in the app</Text>
      {waiting.length > 0 ? (
        <>
          <Text v="small" tone="muted" as="p">Waiting for review:</Text>
          {waiting.map(i => (
            <div key={i.id} style={{ display: 'flex', alignItems: 'center', gap: 12, justifyContent: 'space-between', flexWrap: 'wrap' }}>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                <Text v="label">{i.title}</Text>
                <Text v="caption" tone="subtle">{i.subtitle} · {i.typeLabel}</Text>
              </div>
              <Button size="sm" to={itemPath(i)} aria-label={`Review ${i.title}`}>Review</Button>
            </div>
          ))}
        </>
      ) : (
        <Text v="small" tone="muted" as="p">Nothing from {vendor.brand} is waiting for review.</Text>
      )}
    </Card>
  )
}

function BrandTab({ vendor }: { vendor: Vendor }) {
  const queue = useQueue()
  const waiting = (queue.data?.items ?? []).find(i => i.vendorId === vendor.id && i.kind === 'brand_page')
  if (waiting) {
    return (
      <Banner title="A brand page edit is waiting for review" icon="clock" action={<Button size="sm" to={itemPath(waiting)}>Review</Button>}>
        {waiting.subtitle} · submitted {waiting.submittedLabel.toLowerCase()}
      </Banner>
    )
  }
  return (
    <Card pad={0}>
      <EmptyState icon="store" title={vendor.status === 'approved' ? 'Brand page is up to date' : 'No brand page yet'}>
        {vendor.status === 'approved'
          ? 'There are no brand page edits waiting. When the vendor submits one, it appears in the review queue.'
          : 'The vendor writes their brand page after approval, in the vendor portal.'}
      </EmptyState>
    </Card>
  )
}

/* ---------- Screen ---------- */

function Application({ vendor }: { vendor: Vendor }) {
  useModuleTitle(vendor.brand, ['Vendors', vendor.brand])
  const { toast } = useShell()
  const [tab, setTab] = useState<Tab>('application')
  const [dialog, setDialog] = useState<'info' | 'reject' | 'suspend' | null>(null)
  const open = useOpenApplication()
  const requestInfo = useRequestInfo()
  const reject = useRejectVendor()
  const reactivate = useReactivateVendor()
  const claimed = useRef(false)
  const deciding = needsDecision(vendor)
  const approval = useApprovalSettings({ vendor, onApproved: () => setTab('application') })

  // Opening an application moves it to "under review" so two reviewers don't pick the same one.
  useEffect(() => {
    if (vendor.status === 'applied' && !claimed.current) {
      claimed.current = true
      open.mutate(vendor.id)
    }
  }, [vendor.id, vendor.status])

  const subtitle = `Application ${vendor.applicationRef} · applied ${vendor.appliedLabel} · ${vendor.city}`

  const actions = deciding ? (
    <>
      <Button variant="ghost" icon="mail" onClick={() => setDialog('info')}>Request more info</Button>
      <Button icon="x" onClick={() => setDialog('reject')}>Reject</Button>
      <Button
        variant="primary"
        icon="check"
        onClick={approval.submit}
        disabled={!approval.agreement || approval.pending}
        aria-describedby={approval.agreement ? undefined : 'agreement-hint'}
        title={approval.agreement ? undefined : 'Tick “Vendor agreement signed (offline)” first'}
      >
        {approval.pending ? 'Approving…' : 'Approve and invite'}
      </Button>
    </>
  ) : vendor.status === 'approved' ? (
    <Button variant="danger" icon="ban" onClick={() => setDialog('suspend')}>Suspend</Button>
  ) : vendor.status === 'suspended' ? (
    <Button
      icon="refresh"
      disabled={reactivate.isPending}
      onClick={() => reactivate.mutate(vendor.id, {
        onSuccess: () => toast('success', `${vendor.brand} is active again. Their products return to the app within minutes.`),
        onError: e => toast('error', e.message),
      })}
    >
      Reactivate
    </Button>
  ) : null

  const details: Array<[string, ReactNode]> = [
    ['Brand name', vendor.brand],
    ['Owner', vendor.owner],
    ['Phone (WhatsApp)', vendor.phone],
    ['Email', vendor.email],
    ['City', vendor.city],
    ['Instagram', <TextLink key="ig" to={`https://${vendor.instagram}`} external underline v="small">{vendor.instagram}</TextLink>],
    ['Sells', capitalised(vendor.categories)],
    ['Price range', vendor.priceRange],
    ['About', vendor.about],
  ]

  return (
    <Screen gap={16}>
      <div><BackLink to="/vendors">Vendors</BackLink></div>
      <PageHeader title={vendor.brand} badge={<VendorStatusBadge status={vendor.status} />} subtitle={subtitle} actions={actions} />

      {vendor.statusReason && (vendor.status === 'rejected' || vendor.status === 'suspended') && (
        <Banner
          role="status"
          icon={vendor.status === 'rejected' ? 'x' : 'ban'}
          accent={vendor.status === 'rejected' ? '#E3B9A3' : kit.wine}
          title={vendor.status === 'rejected' ? 'Application rejected' : 'Vendor suspended: their products are hidden from the app'}
        >
          “{vendor.statusReason}”{vendor.status === 'rejected' ? ' Rejected vendors stay on record and can apply again.' : ''}
        </Banner>
      )}

      <Tabs<Tab>
        label="Vendor sections"
        value={tab}
        onChange={setTab}
        items={[
          { value: 'application', label: 'Application' },
          { value: 'products', label: 'Products', count: vendor.liveCount ?? 0 },
          { value: 'brand', label: 'Brand page' },
          { value: 'activity', label: 'Activity', count: vendor.activity.length },
        ]}
      />

      {tab === 'application' && (
        <div style={{ display: 'flex', gap: 20, alignItems: 'flex-start', flexWrap: 'wrap' }}>
          <div style={{ flex: '1 1 440px', minWidth: 0, display: 'flex', flexDirection: 'column', gap: 16 }}>
            <DetailRows rows={details} />
            <Card pad="15px 19px" gap={10}>
              <Text v="label" as="h2">Automatic checks</Text>
              <ul style={{ listStyle: 'none', margin: 0, padding: 0, display: 'flex', flexDirection: 'column', gap: 10 }}>
                {vendor.checks.map(c => (
                  <li key={c.text} style={{ display: 'flex', gap: 8 }}>
                    <Icon name={c.ok ? 'check' : 'alert'} size={16} color={c.ok ? kit.ink : kit.error} label={c.ok ? 'Passed' : 'Needs a closer look'} />
                    <Text v="small" style={{ flex: 1, minWidth: 0 }}>{c.text}</Text>
                  </li>
                ))}
              </ul>
            </Card>
          </div>
          <div style={{ flex: '0 1 360px', minWidth: 280, display: 'flex', flexDirection: 'column', gap: 16 }}>
            {deciding ? approval.card : vendor.status !== 'rejected' ? <VendorSettings vendor={vendor} /> : null}
            <ActivityCard vendor={vendor} limit={4} />
          </div>
        </div>
      )}
      {tab === 'products' && <ProductsTab vendor={vendor} />}
      {tab === 'brand' && <BrandTab vendor={vendor} />}
      {tab === 'activity' && <ActivityCard vendor={vendor} />}

      <ReasonDialog
        open={dialog === 'info'}
        onClose={() => { requestInfo.reset(); setDialog(null) }}
        title={`Ask ${vendor.brand} for more info`}
        subtitle={`Application ${vendor.applicationRef} · ${vendor.owner}`}
        templates={INFO_TEMPLATES}
        reasonLabel="What’s missing"
        messageLabel="Message to the applicant (required)"
        helper="Sent by email and WhatsApp exactly as written"
        consequence="The application stays under review. Their reply shows up in Activity."
        confirmLabel="Send request"
        confirmIcon="send"
        pending={requestInfo.isPending}
        error={requestInfo.error?.message ?? null}
        onConfirm={({ message }) => requestInfo.mutate({ id: vendor.id, message }, {
          onSuccess: () => { requestInfo.reset(); setDialog(null); toast('success', `Asked ${vendor.brand} for more info. It stays under review.`) },
          onError: e => toast('error', e.message),
        })}
      />
      <ReasonDialog
        open={dialog === 'reject'}
        onClose={() => { reject.reset(); setDialog(null) }}
        title={`Reject ${vendor.brand}`}
        subtitle={`Application ${vendor.applicationRef} · ${vendor.owner}`}
        templates={REJECT_TEMPLATES}
        messageLabel="Message to the applicant (required)"
        helper="Shown to the applicant exactly as written"
        consequence={`${vendor.owner} gets an email with this message. The application stays on record and they can apply again.`}
        confirmLabel="Reject application"
        pending={reject.isPending}
        error={reject.error?.message ?? null}
        onConfirm={({ reasons, message }) => reject.mutate({ id: vendor.id, reasons, message }, {
          onSuccess: () => { reject.reset(); setDialog(null); toast('success', `Rejected the ${vendor.brand} application. ${vendor.owner} gets an email.`) },
          onError: e => toast('error', e.message),
        })}
      />
      {vendor.status === 'approved' && <SuspendDialog vendor={vendor} open={dialog === 'suspend'} onClose={() => setDialog(null)} />}
    </Screen>
  )
}

export function VendorApplication() {
  const { id = '' } = useParams()
  const vendor = useVendor(id)
  if (vendor.isPending) return <LoadingDetail />
  if (vendor.isError) {
    const notFound = vendor.error instanceof ApiError && vendor.error.code === 'not_found'
    return (
      <ErrorCard
        title={notFound ? 'No vendor with this link' : 'The vendor didn’t load'}
        onRetry={notFound ? undefined : () => vendor.refetch()}
        back={{ to: '/vendors', label: 'Back to vendors' }}
      >
        {notFound ? 'The link may be out of date. Find the vendor in the list.' : 'vendor-api did not answer. Try again in a moment.'}
      </ErrorCard>
    )
  }
  return <Application key={vendor.data.id} vendor={vendor.data} />
}
