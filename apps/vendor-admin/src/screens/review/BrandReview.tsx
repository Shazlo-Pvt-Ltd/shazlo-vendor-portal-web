// A-07 · Brand page review: live page and submitted draft side by side, a field-by-field diff,
// the brand page checklist, and the same send-back dialog as A-06.
import { Fragment, useState } from 'react'
import { useParams } from 'react-router'
import { Button, Card, Icon, ImagePlaceholder, kit, PageHeader, Rule, StatusBadge, Text } from '@shazlo/ui/components'
import { ApiError, changedBrandFields, useBrandSubmission, useDecideBrand, type BrandPageFields, type BrandSubmission } from '../../api'
import { useModuleTitle, useShell } from '../../app/shell'
import { plural } from '../shared/format'
import { ReasonDialog, type ReasonTemplate } from '../shared/ReasonDialog'
import { CheckItem, DecisionBar, ErrorCard, ItemNav, LoadingDetail, PanelTitle, Screen } from '../shared/ui'
import { Split, useQueueNeighbours } from './shared'

const CHECKLIST = [
  'Images belong to the brand',
  'No phone numbers or outside links in the text',
  'No text baked into the cover image',
  'Story is accurate and respectful',
]

const BRAND_REASONS: ReasonTemplate[] = [
  { label: 'Images don’t belong to the brand', text: 'Some images don’t look like your own products or studio. Please use photos you took or own.' },
  { label: 'Phone number or outside link', text: 'The text has a phone number or a link to another shop. Please remove it; shoppers order through Shazlo.' },
  { label: 'Text in the cover image', text: 'The cover image has text baked into it. Please upload a cover without text; the app adds your name.' },
  { label: 'Story needs changes', text: 'Parts of the story aren’t accurate. Please correct them and resubmit.' },
  { label: 'Other' },
]

type DiffKey = 'cover' | 'logo' | 'tagline' | 'location' | 'story' | 'returnPolicy'

/** Display order of the diff; changed fields come first. */
const DIFF_FIELDS: Array<{ key: DiffKey; label: string; image?: boolean }> = [
  { key: 'cover', label: 'Cover image', image: true },
  { key: 'logo', label: 'Logo', image: true },
  { key: 'tagline', label: 'Tagline' },
  { key: 'location', label: 'Location and dispatch time' },
  { key: 'story', label: 'Story' },
  { key: 'returnPolicy', label: 'Return policy' },
]

const valueOf = (f: BrandPageFields, key: DiffKey) => (key === 'location' ? `${f.location} · ${f.dispatch}` : f[key])

/** The brand page as the app renders it, in a phone frame (290 × 560, narrower to fit a phone frame). */
function Phone({ page, live, draft }: { page: BrandPageFields; live: BrandPageFields | null; draft?: boolean }) {
  const coverChanged = draft && live !== null && live.cover !== page.cover
  return (
    <div
      style={{
        width: 290, maxWidth: '100%', height: 560, boxSizing: 'border-box', border: `5px solid ${draft ? kit.ink : kit.field}`, borderRadius: 30,
        padding: 5, background: kit.surface,
      }}
    >
      <div style={{ height: '100%', borderRadius: 22, overflow: 'hidden', background: kit.surface, display: 'flex', flexDirection: 'column' }}>
        <ImagePlaceholder width="100%" height={110} radius={0} alt={coverChanged ? 'New cover image' : 'Cover image'} style={{ background: coverChanged ? kit.field : kit.placeholder }} />
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6, padding: '12px 14px' }}>
          <span aria-hidden style={{ width: 44, height: 44, borderRadius: 22, background: kit.placeholder, display: 'block' }} />
          <Text v="title">{page.name}</Text>
          <Text v="caption" tone="muted">{page.tagline}</Text>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
            <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}><Icon name="globe" size={12} color={kit.muted} /><Text v="caption" tone="muted">{page.location}</Text></span>
            <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}><Icon name="clock" size={12} color={kit.muted} /><Text v="caption" tone="muted">{page.dispatch}</Text></span>
          </div>
          <Text v="small" as="p">{page.story}</Text>
        </div>
        <div style={{ display: 'flex', gap: 8, padding: '0 14px 14px' }}>
          <ImagePlaceholder width="100%" height={140} style={{ flex: '0 1 117px', minWidth: 0 }} />
          <ImagePlaceholder width="100%" height={140} style={{ flex: '0 1 117px', minWidth: 0 }} />
        </div>
      </div>
    </div>
  )
}

function ImageChange({ label }: { label: string }) {
  const box = (draft: boolean) => (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
      <ImagePlaceholder width={150} height={64} alt={`${draft ? 'Draft' : 'Live'} ${label.toLowerCase()}`} style={{ background: draft ? kit.field : kit.placeholder }} />
      <Text v="caption" tone={draft ? 'ink' : 'subtle'}>{draft ? 'Draft' : 'Live'}</Text>
    </div>
  )
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
      {box(false)}
      <Icon name="arrowRight" size={16} color={kit.ink} label="replaced by" />
      {box(true)}
    </div>
  )
}

function Changes({ brand }: { brand: BrandSubmission }) {
  const changedKeys = new Set(changedBrandFields(brand))
  const isChanged = (k: DiffKey) => (k === 'location' ? changedKeys.has('location') || changedKeys.has('dispatch') : changedKeys.has(k)) || brand.live === null
  const changed = DIFF_FIELDS.filter(f => isChanged(f.key))
  const same = DIFF_FIELDS.filter(f => !isChanged(f.key))
  return (
    <Card pad={16} gap={14}>
      <PanelTitle icon="diff">{brand.live ? 'Changes from the live page' : 'New brand page'}</PanelTitle>
      {changed.map(f => (
        <Fragment key={f.key}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
              <Text v="label" as="h3">{f.label}</Text>
              <StatusBadge tone="pending" icon="clock">{brand.live ? 'Changed' : 'New'}</StatusBadge>
            </div>
            {f.image ? (
              brand.live ? <ImageChange label={f.label} /> : <ImagePlaceholder width={150} height={64} style={{ background: kit.field }} />
            ) : (
              <>
                {brand.live && <Text v="small" tone="subtle" as="p" style={{ textDecoration: 'line-through' }}><span className="shz-visually-hidden">Was: </span>{valueOf(brand.live, f.key)}</Text>}
                <Text v="small" as="p"><span className="shz-visually-hidden">Now: </span>{valueOf(brand.draft, f.key)}</Text>
              </>
            )}
          </div>
          <Rule />
        </Fragment>
      ))}
      {same.map(f => (
        <div key={f.key} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
          <Text v="label" as="h3">{f.label}</Text>
          <Text v="caption" tone="subtle">Same</Text>
        </div>
      ))}
    </Card>
  )
}

function Review({ brand }: { brand: BrandSubmission }) {
  const title = `${brand.vendorName} · brand page`
  useModuleTitle(title, ['Review queue', title])
  const { toast } = useShell()
  const nav = useQueueNeighbours('brand_page', brand.id)
  const decide = useDecideBrand()
  const [checks, setChecks] = useState<string[]>([])
  const [sendBackOpen, setSendBackOpen] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const pending = brand.status === 'pending'
  const decided = brand.decision

  // Diff against the live version captured when the review started, so an approval keeps the diff readable.
  const [snapshot] = useState(brand)
  const compare = pending ? brand : snapshot
  const changeCount = compare.live ? changedBrandFields(compare).filter(k => k !== 'dispatch' || !changedBrandFields(compare).includes('location')).length : 0

  const failure = (e: unknown) => {
    const msg = e instanceof ApiError ? e.message : 'The decision wasn’t saved. Check your connection and try again.'
    toast('error', msg)
    return msg
  }

  const approve = () => decide.mutate({ id: brand.id, outcome: 'approved', checklist: checks }, {
    onSuccess: () => { toast('success', `Approved the ${brand.vendorName} brand page. It’s on its way to the app.`); nav.afterDecision() },
    onError: failure,
  })

  const sendBack = ({ reasons, message }: { reasons: string[]; message: string }) => {
    setError(null)
    decide.mutate({ id: brand.id, outcome: 'sent_back', checklist: checks, reasons, message }, {
      onSuccess: () => { setSendBackOpen(false); toast('success', `Sent the brand page back to ${brand.vendorName}. The live page is unchanged.`); nav.afterDecision() },
      onError: e => setError(failure(e)),
    })
  }

  const badge = brand.status === 'approved'
    ? <StatusBadge tone="approved">Approved</StatusBadge>
    : brand.status === 'sent_back'
      ? <StatusBadge tone="sentBack">Sent back</StatusBadge>
      : <StatusBadge tone="pending" icon="clock">{compare.live ? 'Edit to live page' : 'New brand page'}</StatusBadge>

  const subtitle = [
    `Submitted ${brand.submittedLabel}`,
    compare.live ? `${plural(changeCount, 'field')} changed` : 'first version',
    ...(compare.live && compare.livePublishedLabel ? [`live version published ${compare.livePublishedLabel}`] : []),
  ].join(' · ')

  return (
    <Screen gap={16}>
      <ItemNav position={nav.position} total={nav.total} onPrev={nav.onPrev} onNext={nav.onNext} />
      <PageHeader title={title} badge={badge} subtitle={subtitle} />

      <Split>
        <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap', flex: '0 1 596px', minWidth: 0 }}>
          <section aria-label="Live now" style={{ display: 'flex', flexDirection: 'column', gap: 8, flex: '0 1 290px', minWidth: 0 }}>
            <div style={{ display: 'flex', alignItems: 'center', minHeight: 19 }}>
              <Text v="overline" tone="subtle" as="h2">{compare.live ? 'Live now' : 'Not live yet'}</Text>
            </div>
            {compare.live ? <Phone page={compare.live} live={null} /> : (
              <div style={{ width: 290, maxWidth: '100%', height: 560, boxSizing: 'border-box', borderRadius: 30, border: `1px dashed ${kit.field}`, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 24, textAlign: 'center' }}>
                <Text v="small" tone="muted">This vendor has no live brand page yet.</Text>
              </div>
            )}
          </section>
          <section aria-label="Submitted draft" style={{ display: 'flex', flexDirection: 'column', gap: 8, flex: '0 1 290px', minWidth: 0 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 6, minHeight: 19, flexWrap: 'wrap' }}>
              <Text v="overline" as="h2">Submitted draft</Text>
              {compare.live && <StatusBadge tone="pending" icon="clock">{plural(changeCount, 'change')}</StatusBadge>}
            </div>
            <Phone page={compare.draft} live={compare.live} draft />
          </section>
        </div>

        <div style={{ flex: '1 1 400px', minWidth: 0, display: 'flex', flexDirection: 'column', gap: 16 }}>
          <Changes brand={compare} />
          <Card pad={16} gap={10}>
            <Text v="label" as="h2" id="brand-checklist">Brand page checklist</Text>
            <div role="group" aria-labelledby="brand-checklist" style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              {CHECKLIST.map(item => (
                <CheckItem
                  key={item}
                  label={item}
                  disabled={!pending}
                  checked={pending ? checks.includes(item) : Boolean(decided?.checklist?.includes(item))}
                  onChange={on => setChecks(on ? [...checks, item] : checks.filter(c => c !== item))}
                />
              ))}
            </div>
          </Card>
        </div>
      </Split>

      {pending ? (
        <DecisionBar
          sticky
          actions={
            <>
              <Button icon="x" onClick={() => { setError(null); setSendBackOpen(true) }} disabled={decide.isPending}>Send back</Button>
              <Button variant="primary" icon="check" onClick={approve} disabled={decide.isPending}>
                {decide.isPending && !sendBackOpen ? 'Approving…' : 'Approve and publish'}
              </Button>
            </>
          }
        >
          Approving replaces the live page in the app. Sending back keeps the live page as it is.
        </DecisionBar>
      ) : (
        <DecisionBar icon={brand.status === 'approved' ? 'check' : 'x'} actions={<Button to="/queue" icon="arrowLeft" className="shz-btn">Back to the queue</Button>}>
          {brand.status === 'approved'
            ? `Approved by ${decided?.by ?? 'a reviewer'} · ${decided?.at ?? ''}. The new page replaces the live one once it reaches the app.`
            : `Sent back by ${decided?.by ?? 'a reviewer'} · ${decided?.at ?? ''}. The live page is unchanged.`}
        </DecisionBar>
      )}

      <ReasonDialog
        open={sendBackOpen}
        onClose={() => setSendBackOpen(false)}
        title={`Send back to ${brand.vendorName}`}
        subtitle={`Brand page · ${compare.live ? 'Edit to live page' : 'New brand page'}`}
        templates={BRAND_REASONS}
        consequence={`${brand.vendorName} gets an email and sees this message on their brand page. The live page stays as it is until a new version is approved.`}
        confirmLabel="Send back"
        pending={decide.isPending}
        error={error}
        onConfirm={sendBack}
      />
    </Screen>
  )
}

export function BrandReview() {
  const { id = '' } = useParams()
  const brand = useBrandSubmission(id)
  if (brand.isPending) return <LoadingDetail />
  if (brand.isError) {
    const notFound = brand.error instanceof ApiError && brand.error.code === 'not_found'
    return (
      <ErrorCard
        title={notFound ? 'This brand page isn’t in the queue' : 'The brand page didn’t load'}
        onRetry={notFound ? undefined : () => brand.refetch()}
        back={{ to: '/queue', label: 'Back to the queue' }}
      >
        {notFound ? 'The link may be out of date. Pick the next item from the review queue.' : 'vendor-api did not answer. Try again in a moment.'}
      </ErrorCard>
    )
  }
  return <Review key={brand.data.id} brand={brand.data} />
}
