// A-05 · Product review, with A-06 · Send back (reason required).
import { useState } from 'react'
import { useParams } from 'react-router'
import { Button, Card, Icon, ImagePlaceholder, kit, PageHeader, StatusBadge, TableFrame, Text } from '@shazlo/ui/components'
import { ApiError, useDecideProduct, useProductSubmission, type ProductSubmission } from '../../api'
import { useModuleTitle, useShell } from '../../app/shell'
import { plural } from '../shared/format'
import { ReasonDialog, type ReasonTemplate } from '../shared/ReasonDialog'
import { CheckItem, DecisionBar, ErrorCard, ItemNav, LoadingDetail, PanelTitle, Screen } from '../shared/ui'
import { DiffTable, Split, useQueueNeighbours } from './shared'

const CHECKLIST = [
  'Front, back and close-up photos',
  'Price matches the MRP on the tag',
  'Category and fabric are right',
  'Not on the prohibited list',
  'Description is accurate',
]

export const PRODUCT_REASONS: ReasonTemplate[] = [
  { label: 'Photo missing or unclear', text: 'A photo is missing or unclear. Add front, back and a fabric close-up taken in daylight, then resubmit.' },
  { label: 'Price doesn’t match the tag', text: 'The price doesn’t match the MRP on the tag in the photos. Please check the price and MRP, then resubmit.' },
  { label: 'Wrong category or fabric', text: 'The category or fabric doesn’t match the product in the photos. Please correct it and resubmit.' },
  { label: 'Description doesn’t match photos', text: 'The description doesn’t match the photos. Please correct the description or the photos and resubmit.' },
  { label: 'Prohibited item', text: 'This item is on Shazlo’s prohibited list, so it can’t be sold on the app.' },
  { label: 'Other' },
]

export const typeLabelOf = (p: Pick<ProductSubmission, 'change' | 'resubmission'>) =>
  p.change === 'resubmission' ? `Resubmission #${p.resubmission ?? 1}` : p.change === 'edit' ? 'Edit to live product' : 'New product'

function Badge({ product }: { product: ProductSubmission }) {
  if (product.status === 'approved') return <StatusBadge tone="approved">Approved</StatusBadge>
  if (product.status === 'sent_back') return <StatusBadge tone="sentBack">Sent back</StatusBadge>
  return <StatusBadge tone="pending" icon="clock">{typeLabelOf(product)}</StatusBadge>
}

function Photos({ product }: { product: ProductSubmission }) {
  const [selected, setSelected] = useState(0)
  const current = product.photos[selected] ?? product.photos[0]
  return (
    <section aria-label="Photos" style={{ flex: '0 1 400px', minWidth: 280, display: 'flex', flexDirection: 'column', gap: 10 }}>
      <ImagePlaceholder width="100%" height="auto" alt={current ? `${current.label} photo` : 'Photo'} style={{ aspectRatio: '400 / 470' }} />
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, minmax(0, 1fr))', gap: 8 }}>
        {product.photos.map((p, i) => (
          <button
            key={p.label}
            type="button"
            aria-pressed={i === selected}
            aria-label={`Show ${p.label.toLowerCase()} photo${p.isNew ? ' (new)' : ''}`}
            onClick={() => setSelected(i)}
            style={{ display: 'flex', flexDirection: 'column', gap: 4, padding: 0, border: 0, background: 'none', cursor: 'pointer', textAlign: 'left', minWidth: 0 }}
          >
            <ImagePlaceholder
              width="100%"
              height="auto"
              style={{ aspectRatio: '94 / 112', outline: i === selected ? `2px solid ${kit.brown}` : undefined, outlineOffset: -2 }}
            />
            <span style={{ display: 'flex', alignItems: 'center', gap: 4, minHeight: 19 }}>
              <Text v="caption" tone="muted">{p.label}</Text>
              {p.isNew && <StatusBadge tone="pending" icon="clock">New</StatusBadge>}
            </span>
          </button>
        ))}
      </div>
    </section>
  )
}

function Changes({ product }: { product: ProductSubmission }) {
  const isNew = product.change === 'new'
  const changed = product.fields.filter(f => f.before !== null && f.before !== f.after).length
  const heading = isNew ? 'New product, first review' : product.change === 'edit' ? 'Compared with the live version' : 'Compared with the version you sent back'
  return (
    <Card pad={16} gap={12}>
      <PanelTitle icon="diff" aside={<Text v="caption" tone="subtle">{isNew ? plural(product.fields.length, 'field') : plural(changed, 'change')}</Text>}>{heading}</PanelTitle>
      <TableFrame style={{ position: 'relative' }}>
        <DiffTable aria-label={heading} style={{ minWidth: 520 }}>
          <colgroup>
            <col style={{ width: 120 }} />
            <col />
            {!isNew && <col />}
            {!isNew && <col style={{ width: 98 }} />}
          </colgroup>
          <thead>
            <tr>
              <th scope="col">Field</th>
              {!isNew && <th scope="col">{product.change === 'edit' ? 'Live version' : 'Sent back version'}</th>}
              <th scope="col">This submission</th>
              {!isNew && <th scope="col"><span className="shz-visually-hidden">Change</span></th>}
            </tr>
          </thead>
          <tbody>
            {product.fields.map(f => {
              const same = f.before !== null && f.before === f.after
              return (
                <tr key={f.field}>
                  <td><Text v="small" tone="muted">{f.field}</Text></td>
                  {!isNew && (
                    <td>
                      <Text v="small" tone={same ? 'ink' : 'subtle'} style={same ? undefined : { textDecoration: 'line-through' }}>
                        {f.before ?? '—'}
                      </Text>
                    </td>
                  )}
                  <td>{same ? <Text v="label">Same</Text> : isNew ? <Text v="small">{f.after}</Text> : <Text v="label">{f.after}</Text>}</td>
                  {!isNew && <td>{!same && <StatusBadge tone="pending" icon="clock">Changed</StatusBadge>}</td>}
                </tr>
              )
            })}
          </tbody>
        </DiffTable>
      </TableFrame>
    </Card>
  )
}

function Review({ product }: { product: ProductSubmission }) {
  const title = product.title
  useModuleTitle(title, ['Review queue', title])
  const { toast } = useShell()
  const nav = useQueueNeighbours('product', product.id)
  const decide = useDecideProduct()
  const [checks, setChecks] = useState<string[]>([])
  const [sendBackOpen, setSendBackOpen] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const pending = product.status === 'pending'
  const decided = product.decision

  const onError = (e: unknown) => {
    const msg = e instanceof ApiError ? e.message : 'The decision wasn’t saved. Check your connection and try again.'
    toast('error', msg)
    return msg
  }

  const approve = () => {
    decide.mutate({ id: product.id, outcome: 'approved', checklist: checks }, {
      onSuccess: () => {
        toast('success', `Approved “${title}”. It’s on its way to the app.`)
        nav.afterDecision()
      },
      onError,
    })
  }

  const sendBack = ({ reasons, message }: { reasons: string[]; message: string }) => {
    setError(null)
    decide.mutate({ id: product.id, outcome: 'sent_back', checklist: checks, reasons, message }, {
      onSuccess: () => {
        setSendBackOpen(false)
        toast('success', `Sent “${title}” back to ${product.vendorName}.`)
        nav.afterDecision()
      },
      onError: e => setError(onError(e)),
    })
  }

  const subtitle = `${product.vendorName} · ${product.sku} · submitted ${product.submittedLabel}${product.note ? ` · ${product.note}` : ''}`

  return (
    <Screen gap={16}>
      <ItemNav position={nav.position} total={nav.total} onPrev={nav.onPrev} onNext={nav.onNext} />
      <PageHeader title={title} badge={<Badge product={product} />} subtitle={subtitle} />

      <Split>
        <Photos product={product} />
        <div style={{ flex: '1 1 420px', minWidth: 0, display: 'flex', flexDirection: 'column', gap: 16 }}>
          <Changes product={product} />

          <Card pad={16} gap={8}>
            <Text v="label" as="h2">Description</Text>
            <Text v="small" tone="muted" as="p">{product.description}</Text>
          </Card>

          <Card pad={16} gap={10}>
            <Text v="label" as="h2" id="product-checklist">Review checklist</Text>
            <div role="group" aria-labelledby="product-checklist" style={{ display: 'flex', flexWrap: 'wrap', columnGap: 24, rowGap: 24 }}>
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

          {product.previousDecision && (
            <div style={{ display: 'flex', gap: 10, padding: '12px 14px', background: kit.chip, borderRadius: 8 }}>
              <Icon name="clock" size={16} color={kit.ink} />
              <div style={{ display: 'flex', flexDirection: 'column', gap: 2, flex: 1, minWidth: 0 }}>
                <Text v="caption" tone="subtle">Sent back by {product.previousDecision.by} · {product.previousDecision.at}</Text>
                <Text v="small" as="p">{product.previousDecision.message}</Text>
              </div>
            </div>
          )}
        </div>
      </Split>

      {pending ? (
        <DecisionBar
          actions={
            <>
              <Button icon="x" onClick={() => { setError(null); setSendBackOpen(true) }} disabled={decide.isPending}>Send back</Button>
              <Button variant="primary" icon="check" onClick={approve} disabled={decide.isPending}>
                {decide.isPending && !sendBackOpen ? 'Approving…' : 'Approve and publish'}
              </Button>
            </>
          }
        >
          Your decision is saved with your name and the time. Approving publishes the product to the app.
        </DecisionBar>
      ) : (
        <DecisionBar
          icon={product.status === 'approved' ? 'check' : 'x'}
          actions={<Button to="/queue" icon="arrowLeft">Back to the queue</Button>}
        >
          {product.status === 'approved'
            ? `Approved by ${decided?.by ?? 'a reviewer'} · ${decided?.at ?? ''}. Publishing to the app; follow it in Publishing status.`
            : `Sent back by ${decided?.by ?? 'a reviewer'} · ${decided?.at ?? ''}${decided?.message ? `: “${decided.message}”` : '.'}`}
        </DecisionBar>
      )}

      <ReasonDialog
        open={sendBackOpen}
        onClose={() => setSendBackOpen(false)}
        title={`Send back to ${product.vendorName}`}
        subtitle={`${title} · ${typeLabelOf(product)}`}
        templates={PRODUCT_REASONS}
        consequence={
          product.change === 'edit'
            ? `${product.vendorName} gets an email and sees this message on the product. The live version stays in the app; only this edit is sent back.`
            : `${product.vendorName} gets an email and sees this message on the product. It stays off the app until a new version is approved.`
        }
        confirmLabel="Send back"
        pending={decide.isPending}
        error={error}
        onConfirm={sendBack}
      />
    </Screen>
  )
}

export function ProductReview() {
  const { id = '' } = useParams()
  const product = useProductSubmission(id)
  if (product.isPending) return <LoadingDetail />
  if (product.isError) {
    const notFound = product.error instanceof ApiError && product.error.code === 'not_found'
    return (
      <ErrorCard
        title={notFound ? 'This submission isn’t in the queue' : 'The submission didn’t load'}
        onRetry={notFound ? undefined : () => product.refetch()}
        back={{ to: '/queue', label: 'Back to the queue' }}
      >
        {notFound ? 'The vendor may have withdrawn it, or the link is out of date. Pick the next item from the review queue.' : 'vendor-api did not answer. Try again in a moment.'}
      </ErrorCard>
    )
  }
  return <Review key={product.data.id} product={product.data} />
}
