// V-05 Brand page editor (desktop) and V-05m (mobile), from the Penpot page "01 · Vendor Portal".
import useMediaQuery from '@mui/material/useMediaQuery'
import { styled } from '@mui/material/styles'
import { useEffect, useRef, useState, type ReactNode } from 'react'
import {
  Banner, Button, Card, Content, Dialog, Icon, kit, PageHeader, Select, Skeleton, StatusBadge, Text, TextArea, TextInput, textStyle, useToast,
} from '@shazlo/ui/components'
import { useBrandProfile, useDiscardBrandDraft, useOverview, useSaveBrandDraft, useSubmitBrandPage } from '../../api/hooks'
import type { BrandProfile, BrandProfileFields } from '../../api/types'
import { TopBar } from '../../app/topbar'
import { MOBILE_QUERY } from '../../app/VendorShell'
import { BarIcon, MobilePageBar, RowMenu } from '../products/shared'
import { useNavigate } from 'react-router'
import { BrandPreview, ImageTile, PhoneFrame, VersionToggle } from './BrandPreview'
import { changedList, cityOptions, dispatchOptions, returnOptions, TAGLINE_MAX, STORY_MAX, validateBrand, type BrandErrors } from './brandForm'

type Key = keyof BrandProfileFields
type SaveState = 'saved' | 'saving' | 'error'

/** Fields the editor shows, in screen order (also the order focus moves through errors). */
const FIELD_ORDER: Key[] = ['logoUrl', 'coverUrl', 'brandName', 'city', 'tagline', 'story', 'returnPolicy', 'shipsIn', 'instagram', 'website']
const fieldId = (k: Key) => `brand-${k}`
const same = (a: unknown, b: unknown) => JSON.stringify(a ?? null) === JSON.stringify(b ?? null)
const AUTOSAVE_MS = 800

export function BrandEditor() {
  const mobile = useMediaQuery(MOBILE_QUERY, { noSsr: true })
  const brand = useBrandProfile()
  if (brand.isError) {
    return (
      <Content>
        <TopBar crumbs={[{ label: 'Brand page', to: '/brand' }, { label: 'Edit draft' }]} />
        <Banner role="alert" title="We couldn’t load your brand page" action={<Button size="sm" icon="refresh" onClick={() => brand.refetch()}>Try again</Button>}>
          Check your connection and try again. Your draft is saved on Shazlo, so nothing is lost.
        </Banner>
      </Content>
    )
  }
  if (!brand.data) return <EditorSkeleton mobile={mobile} />
  return <BrandForm profile={brand.data} mobile={mobile} />
}

function BrandForm({ profile, mobile }: { profile: BrandProfile; mobile: boolean }) {
  const toast = useToast()
  const save = useSaveBrandDraft()
  const discard = useDiscardBrandDraft()
  const submit = useSubmitBrandPage()
  const live = useOverview().data?.counts.live

  const [form, setForm] = useState<BrandProfileFields>(profile.draft)
  const [errors, setErrors] = useState<BrandErrors>({})
  const [saveState, setSaveState] = useState<SaveState>('saved')
  const [confirmDiscard, setConfirmDiscard] = useState(false)
  const [version, setVersion] = useState<'draft' | 'live'>('draft')
  const [mode, setMode] = useState<'edit' | 'preview'>('edit')

  // Autosave (V-05m: "drafts save automatically"). The latest values live in a ref so the
  // debounce and the save-on-leave below always send what the vendor last typed.
  const latest = useRef(form)
  const dirty = useRef(false)
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
  const saveRef = useRef(save.mutateAsync)
  saveRef.current = save.mutateAsync

  const navigate = useNavigate()
  const locked = profile.status === 'pending_review'
  const published = profile.published
  const changed = FIELD_ORDER.filter(k => (published ? !same(form[k], published[k]) : Boolean(form[k])))
  const isChanged = (k: Key) => changed.includes(k)
  const n = changed.length

  async function flush() {
    clearTimeout(timer.current)
    if (!dirty.current) return
    dirty.current = false
    setSaveState('saving')
    try {
      await saveRef.current(latest.current)
      setSaveState('saved')
    } catch {
      dirty.current = true
      setSaveState('error')
    }
  }

  useEffect(() => () => {
    // Leaving the page with an unsaved edit: save it so nothing is lost.
    clearTimeout(timer.current)
    if (dirty.current) void saveRef.current(latest.current).catch(() => undefined)
  }, [])

  function update<K extends Key>(key: K, value: BrandProfileFields[K]) {
    const next = { ...form, [key]: value }
    setForm(next)
    latest.current = next
    dirty.current = true
    setSaveState('saving')
    if (errors[key]) setErrors(e => ({ ...e, [key]: validateBrand(next)[key] }))
    clearTimeout(timer.current)
    timer.current = setTimeout(() => void flush(), AUTOSAVE_MS)
  }

  function onImage(key: 'logoUrl' | 'coverUrl', file: File | undefined) {
    if (!file) return
    if (!/^image\/(png|jpe?g)$/.test(file.type)) return setErrors(e => ({ ...e, [key]: 'Use a PNG or JPG image.' }))
    if (file.size > 10 * 1024 * 1024) return setErrors(e => ({ ...e, [key]: 'This image is over 10 MB. Use a smaller one.' }))
    setErrors(e => ({ ...e, [key]: undefined }))
    // In production this is a signed Cloudinary upload; the mock keeps a local preview URL.
    update(key, URL.createObjectURL(file))
  }

  async function onSubmit() {
    if (locked || n === 0) return
    const errs = validateBrand(form)
    setErrors(errs)
    const first = FIELD_ORDER.find(k => errs[k])
    if (first) {
      if (mobile) setMode('edit')
      requestAnimationFrame(() => document.getElementById(fieldId(first))?.focus())
      return
    }
    clearTimeout(timer.current)
    dirty.current = false
    try {
      setSaveState('saving')
      await save.mutateAsync(form)
      setSaveState('saved')
      await submit.mutateAsync()
      toast.show('Sent for review. The Shazlo review team usually decides within 24 hours.')
    } catch (e) {
      setSaveState('saved')
      toast.show(e instanceof Error ? e.message : 'We couldn’t submit your draft. Try again.', 'error')
    }
  }

  async function onDiscard() {
    clearTimeout(timer.current)
    dirty.current = false
    try {
      const b = await discard.mutateAsync()
      setForm(b.draft)
      latest.current = b.draft
      setErrors({})
      setSaveState('saved')
      setConfirmDiscard(false)
      toast.show('Draft discarded. Your brand page is back to the live version.')
    } catch (e) {
      toast.show(e instanceof Error ? e.message : 'We couldn’t discard the draft. Try again.', 'error')
    }
  }

  const statusBadge = locked
    ? <StatusBadge tone="pending" />
    : profile.status === 'rejected'
      ? <StatusBadge tone="sentBack" />
      : n > 0
        ? <StatusBadge tone="draft">Draft · {n} {n === 1 ? 'change' : 'changes'}</StatusBadge>
        : <StatusBadge tone="live">Live · no changes</StatusBadge>
  const statusText = locked ? 'Pending review' : profile.status === 'rejected' ? 'Sent back' : n > 0 ? `Draft · ${n} ${n === 1 ? 'change' : 'changes'}` : 'Live · no changes'
  const saveText = saveState === 'saving' ? 'saving…' : saveState === 'error' ? 'not saved' : 'saved'
  const busy = submit.isPending
  const submitReason = locked ? 'Your draft is already with the review team.' : n === 0 ? 'Nothing to submit: your draft matches the live page.' : undefined

  const discardButton = (
    <Button variant="ghost" onClick={() => setConfirmDiscard(true)} disabled={locked || n === 0} title={locked ? 'You can’t discard a draft that is in review.' : n === 0 ? 'There is no draft to discard.' : undefined}>
      {mobile ? 'Discard' : 'Discard draft'}
    </Button>
  )
  const submitButton = (
    <Button variant="primary" icon="send" onClick={onSubmit} disabled={Boolean(submitReason) || busy} aria-describedby={submitReason ? 'brand-submit-reason' : undefined} fullWidth={mobile} style={mobile ? { flex: 1 } : undefined}>
      {submit.isPending ? 'Submitting…' : 'Submit for review'}
    </Button>
  )

  const notices = (
    <>
      {locked && (
        <Banner icon="clock" title="Your draft is with the Shazlo review team" action={<Button size="sm" to="/review">See review status</Button>}>
          Usually reviewed within 24 hours. You can edit it again once they decide; your live page stays as it is until then.
        </Banner>
      )}
      {profile.status === 'rejected' && profile.lastDecision?.reason && (
        <Banner title="Your draft was sent back by the review team">“{profile.lastDecision.reason}” Fix it and submit again.</Banner>
      )}
      {saveState === 'error' && (
        <Banner role="alert" title="Your last change isn’t saved yet" action={<Button size="sm" icon="refresh" onClick={() => { dirty.current = true; void flush() }}>Save again</Button>}>
          Check your connection. We keep your changes on this page until the save works.
        </Banner>
      )}
    </>
  )

  const formCards = (
    <fieldset disabled={locked} style={{ border: 0, padding: 0, margin: 0, minWidth: 0, display: 'flex', flexDirection: 'column', gap: mobile ? 16 : 20 }}>
      <legend className="shz-visually-hidden">Brand page draft</legend>
      <Card pad={mobile ? 16 : 20} gap={mobile ? 16 : 18} as="section" aria-labelledby="brand-identity">
        <Text v="title" as="h2" id="brand-identity">Identity</Text>
        <LogoRow form={form} mobile={mobile} changed={isChanged('logoUrl')} error={errors.logoUrl} onFile={f => onImage('logoUrl', f)} />
        <CoverField form={form} mobile={mobile} changed={isChanged('coverUrl')} error={errors.coverUrl} onFile={f => onImage('coverUrl', f)} />
        <TwoUp mobile={mobile}>
          <TextInput
            id={fieldId('brandName')}
            label="Brand name"
            value={form.brandName}
            readOnly
            aria-readonly="true"
            helper="Contact us to change your brand name."
          />
          <Select
            id={fieldId('city')}
            label="Based in"
            labelAside={isChanged('city') ? <ChangedTag /> : undefined}
            value={form.city}
            onChange={e => update('city', e.target.value)}
            options={cityOptions(form.city)}
          />
        </TwoUp>
        <TextInput
          id={fieldId('tagline')}
          label="Tagline"
          labelAside={isChanged('tagline') ? <ChangedTag /> : undefined}
          value={form.tagline}
          maxLength={TAGLINE_MAX}
          onChange={e => update('tagline', e.target.value)}
          error={errors.tagline}
          helper={`${form.tagline.length} / ${TAGLINE_MAX}`}
        />
        <TextArea
          id={fieldId('story')}
          label="Story"
          labelAside={isChanged('story') ? <ChangedTag /> : undefined}
          value={form.story}
          maxLength={STORY_MAX}
          rows={3}
          onChange={e => update('story', e.target.value)}
          error={errors.story}
          helper={`${form.story.length} / ${STORY_MAX}`}
          style={{ gap: 8 }}
        />
      </Card>
      <Card pad={mobile ? 16 : 20} gap={mobile ? 16 : 18} as="section" aria-labelledby="brand-shopping">
        <Text v="title" as="h2" id="brand-shopping">Shopping details</Text>
        <TwoUp mobile={mobile}>
          <Select
            id={fieldId('returnPolicy')}
            label="Return policy"
            labelAside={isChanged('returnPolicy') ? <ChangedTag /> : undefined}
            value={form.returnPolicy}
            onChange={e => update('returnPolicy', e.target.value)}
            options={returnOptions(form.returnPolicy)}
          />
          <Select
            id={fieldId('shipsIn')}
            label="Dispatch time"
            labelAside={isChanged('shipsIn') ? <ChangedTag /> : undefined}
            value={form.shipsIn}
            onChange={e => update('shipsIn', e.target.value)}
            options={dispatchOptions(form.shipsIn)}
          />
        </TwoUp>
        <TwoUp mobile={mobile}>
          <TextInput
            id={fieldId('instagram')}
            label="Instagram"
            labelAside={isChanged('instagram') ? <ChangedTag /> : undefined}
            value={form.instagram}
            onChange={e => update('instagram', e.target.value)}
            error={errors.instagram}
            autoComplete="off"
            spellCheck={false}
          />
          <TextInput
            id={fieldId('website')}
            label="Website (optional)"
            labelAside={isChanged('website') ? <ChangedTag /> : undefined}
            value={form.website}
            onChange={e => update('website', e.target.value)}
            error={errors.website}
            inputMode="url"
            autoComplete="url"
            spellCheck={false}
          />
        </TwoUp>
      </Card>
    </fieldset>
  )

  const previewFields = version === 'live' && published ? published : form
  const discardDialog = (
    <Dialog
      open={confirmDiscard}
      onClose={() => setConfirmDiscard(false)}
      icon="trash"
      title="Discard your draft?"
      description={`Your ${n === 1 ? 'change' : `${n} changes`} (${changedList(changed)}) will be deleted. Your live brand page doesn’t change.`}
      actions={(
        <>
          <Button onClick={() => setConfirmDiscard(false)}>Keep editing</Button>
          <Button variant="danger" icon="trash" onClick={onDiscard} disabled={discard.isPending}>{discard.isPending ? 'Discarding…' : 'Discard draft'}</Button>
        </>
      )}
    />
  )

  if (mobile) {
    return (
      <>
        <MobilePageBar
          hideTabBar
          title="Brand page"
          caption={<span aria-live="polite">{statusText} · {saveText}</span>}
          leading={<BarIcon label="Back to overview" icon="arrowLeft" onClick={() => navigate('/')} />}
          trailing={
            <span style={{ marginRight: 4 }}>
              <RowMenu label="More actions" size={22} actions={[{ label: 'Discard draft', icon: 'trash', danger: true, onClick: () => setConfirmDiscard(true), disabled: locked || n === 0 }]} />
            </span>
          }
        />
        <div style={{ position: 'sticky', top: 56, zIndex: 9, background: kit.surface, borderBottom: `1px solid ${kit.line}` }}>
          <div style={{ padding: '8px 16px' }}>
            <Segmented
              label="Edit or preview"
              value={mode}
              onChange={setMode}
              items={[{ value: 'edit', label: 'Edit' }, { value: 'preview', label: 'Preview in app', icon: 'eye' }]}
            />
          </div>
        </div>
        <Content style={{ padding: '16px 16px 105px', gap: 16 }}>
          {notices}
          {mode === 'edit' ? formCards : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
                <Text v="label">{version === 'live' ? 'What shoppers see now' : 'Your draft'}</Text>
                <VersionToggle value={version} onChange={setVersion} liveAvailable={Boolean(published)} />
              </div>
              <div style={{ border: `1px solid ${kit.line}`, borderRadius: 8, overflow: 'hidden' }}>
                <BrandPreview fields={previewFields} tiles={live} />
              </div>
              <Text v="caption" tone="subtle" style={{ textAlign: 'center' }}>Product tiles show only approved products.</Text>
            </div>
          )}
        </Content>
        <div style={{ position: 'fixed', left: 0, right: 0, bottom: 0, zIndex: 30, background: kit.surface, borderTop: `1px solid ${kit.line}`, display: 'flex', alignItems: 'center', gap: 8, padding: '12px 16px calc(20px + env(safe-area-inset-bottom))' }}>
          {discardButton}
          {submitButton}
          {submitReason && <span id="brand-submit-reason" className="shz-visually-hidden">{submitReason}</span>}
        </div>
        {discardDialog}
      </>
    )
  }

  return (
    <Content>
      <TopBar crumbs={[{ label: 'Brand page', to: '/brand' }, { label: 'Edit draft' }]} />
      <PageHeader
        title="Brand page"
        badge={statusBadge}
        subtitle="Changes are saved as a draft. Your live page stays the same until our team approves the draft."
        actions={(
          <>
            {submitReason && !locked ? (
              <Text v="caption" tone="subtle" id="brand-submit-reason" style={{ marginRight: 4 }}>{submitReason}</Text>
            ) : (
              <SaveIndicator state={saveState} locked={locked} />
            )}
            {locked && <span id="brand-submit-reason" className="shz-visually-hidden">{submitReason}</span>}
            {discardButton}
            {submitButton}
          </>
        )}
      />
      {notices}
      <EditorColumns>
        <form onSubmit={e => { e.preventDefault(); void onSubmit() }} noValidate style={{ minWidth: 0 }}>{formCards}</form>
        <section aria-labelledby="brand-preview" style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 12, minWidth: 0 }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8, width: '100%' }}>
            <span style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              <Icon name="eye" size={16} color={kit.ink} />
              <Text v="label" as="h2" id="brand-preview">Preview in the Shazlo app</Text>
            </span>
            <VersionToggle value={version} onChange={setVersion} liveAvailable={Boolean(published)} />
          </div>
          <PhoneFrame>
            <BrandPreview fields={previewFields} tiles={live} />
          </PhoneFrame>
          <Text v="caption" tone="subtle">Product tiles show only approved products.</Text>
        </section>
      </EditorColumns>
      {discardDialog}
    </Content>
  )
}

/* ---------- Pieces ---------- */

const EditorColumns = styled('div')({
  display: 'grid',
  gridTemplateColumns: 'minmax(0, 1fr) 400px',
  gap: 32,
  alignItems: 'start',
  '@media (max-width: 1180px)': { gridTemplateColumns: 'minmax(0, 1fr)' },
})

function TwoUp({ mobile, children }: { mobile: boolean; children: ReactNode }) {
  return <div style={{ display: 'grid', gridTemplateColumns: mobile ? 'minmax(0, 1fr)' : 'repeat(auto-fit, minmax(220px, 1fr))', gap: 16, alignItems: 'start' }}>{children}</div>
}

/** "Changed" tag beside a field label: the draft differs from the live page (the reviewer sees the same diff in A-07). */
function ChangedTag() {
  return (
    <span style={{ marginRight: 'auto', display: 'inline-flex' }}>
      <StatusBadge tone="pending">Changed<span className="shz-visually-hidden"> from the live page</span></StatusBadge>
    </span>
  )
}

function SaveIndicator({ state, locked }: { state: SaveState; locked: boolean }) {
  if (locked) return null
  const text = state === 'saving' ? 'Saving draft…' : state === 'error' ? 'Not saved' : 'Draft saved'
  return (
    <span aria-live="polite" style={{ display: 'inline-flex', alignItems: 'center', gap: 4, marginRight: 4, ...textStyle.caption, color: state === 'error' ? kit.error : kit.subtle }}>
      <Icon name={state === 'saving' ? 'refresh' : state === 'error' ? 'alert' : 'check'} size={12} />{text}
    </span>
  )
}

function FileButton({ id, label, icon, onFile, capture, ariaLabel }: { id?: string; label: string; icon?: 'upload' | 'image'; onFile: (f: File | undefined) => void; capture?: boolean; ariaLabel?: string }) {
  const input = useRef<HTMLInputElement>(null)
  return (
    <>
      <Button id={id} size="sm" icon={icon} onClick={() => input.current?.click()} aria-label={ariaLabel} fullWidth={capture !== undefined} style={capture !== undefined ? { flex: 1 } : undefined}>{label}</Button>
      <input
        ref={input}
        type="file"
        accept="image/png,image/jpeg"
        capture={capture ? 'environment' : undefined}
        hidden
        onChange={e => { onFile(e.target.files?.[0]); e.target.value = '' }}
      />
    </>
  )
}

function FieldError({ id, children }: { id: string; children?: ReactNode }) {
  if (!children) return null
  return (
    <div id={id} role="alert" style={{ display: 'flex', alignItems: 'center', gap: 4, ...textStyle.caption, color: kit.error }}>
      <Icon name="alert" size={12} strokeWidth={1.75} /><span>{children}</span>
    </div>
  )
}

function LogoRow({ form, mobile, changed, error, onFile }: { form: BrandProfileFields; mobile: boolean; changed: boolean; error?: string; onFile: (f: File | undefined) => void }) {
  const size = mobile ? 56 : 72
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: mobile ? 12 : 16 }}>
        <ImageTile url={form.logoUrl} width={size} height={size} radius={size / 2} />
        <div style={{ display: 'flex', flexDirection: 'column', gap: mobile ? 2 : 4, flex: 1, minWidth: 0 }}>
          <span style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <Text v="label" id="brand-logo-label">Logo</Text>
            {changed && <ChangedTag />}
          </span>
          <Text v="caption" tone="subtle">{mobile ? 'Square, 400 × 400 px or more' : 'Square PNG or JPG, at least 400 × 400 px.'}</Text>
        </div>
        <FileButton id={fieldId('logoUrl')} label={mobile ? 'Change' : 'Replace'} icon={mobile ? undefined : 'upload'} onFile={onFile} ariaLabel={mobile ? 'Change logo' : 'Replace logo'} />
      </div>
      <FieldError id="brand-logo-error">{error}</FieldError>
    </div>
  )
}

const CoverButton = styled('button')({
  position: 'relative',
  display: 'block',
  width: '100%',
  padding: 0,
  border: 0,
  borderRadius: 6,
  background: 'transparent',
  cursor: 'pointer',
  overflow: 'hidden',
  '& .shz-cover-hint': { opacity: 0, transition: 'opacity 150ms ease-out' },
  '&:hover .shz-cover-hint, &:focus-visible .shz-cover-hint': { opacity: 1 },
  '&:focus-visible': { outline: `2px solid ${kit.focus}`, outlineOffset: 2 },
  '&:disabled': { cursor: 'not-allowed' },
})

function CoverField({ form, mobile, changed, error, onFile }: { form: BrandProfileFields; mobile: boolean; changed: boolean; error?: string; onFile: (f: File | undefined) => void }) {
  const input = useRef<HTMLInputElement>(null)
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
      <span style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <Text v="label">Cover image</Text>
        {changed && <ChangedTag />}
      </span>
      {mobile ? (
        <>
          <ImageTile url={form.coverUrl} width="100%" height={120} radius={6} />
          <div style={{ display: 'flex', gap: 8 }}>
            <FileButton id={fieldId('coverUrl')} label="Take photo" icon="image" capture onFile={onFile} ariaLabel="Take a cover photo" />
            <FileButton label="Choose from gallery" icon="upload" capture={false} onFile={onFile} ariaLabel="Choose a cover image from the gallery" />
          </div>
        </>
      ) : (
        <>
          <CoverButton type="button" id={fieldId('coverUrl')} onClick={() => input.current?.click()} aria-label="Replace cover image" aria-describedby="brand-cover-help">
            <ImageTile url={form.coverUrl} width="100%" height={150} radius={6} />
            <span className="shz-cover-hint" style={{ position: 'absolute', right: 10, bottom: 10, display: 'inline-flex', alignItems: 'center', gap: 6, background: kit.surface, border: `1px solid ${kit.field}`, borderRadius: 6, padding: '5px 10px', ...textStyle.caption, color: kit.ink }}>
              <Icon name="upload" size={14} />Replace
            </span>
          </CoverButton>
          <input ref={input} type="file" accept="image/png,image/jpeg" hidden onChange={e => { onFile(e.target.files?.[0]); e.target.value = '' }} />
        </>
      )}
      {error ? <FieldError id="brand-cover-error">{error}</FieldError> : !mobile && (
        <Text v="caption" tone="subtle" id="brand-cover-help">Shown at the top of your page in the app. 1600 × 600 px recommended. Avoid text on the image.</Text>
      )}
    </div>
  )
}

function Segmented<T extends string>({ label, value, onChange, items }: { label: string; value: T; onChange: (v: T) => void; items: Array<{ value: T; label: string; icon?: 'eye' }> }) {
  return (
    <div role="group" aria-label={label} style={{ display: 'flex', background: kit.chip, borderRadius: 8, padding: 3 }}>
      {items.map(item => {
        const active = item.value === value
        return (
          <button
            key={item.value}
            type="button"
            aria-pressed={active}
            onClick={() => onChange(item.value)}
            style={{
              flex: 1, minHeight: 28, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6, padding: '6px 0', border: 0, borderRadius: 6, cursor: 'pointer',
              background: active ? kit.surface : 'transparent', color: active ? kit.ink : kit.muted, ...(active ? textStyle.label : textStyle.small),
              transition: 'background-color 150ms ease-out',
            }}
          >
            {item.icon && <Icon name={item.icon} size={14} />}
            {item.label}
          </button>
        )
      })}
    </div>
  )
}

function EditorSkeleton({ mobile }: { mobile: boolean }) {
  return (
    <Content aria-busy="true" style={mobile ? { padding: '16px 16px 105px', gap: 16 } : undefined}>
      <TopBar crumbs={[{ label: 'Brand page', to: '/brand' }, { label: 'Edit draft' }]} />
      <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
        <Skeleton width={274} height={32} />
        <Skeleton width="60%" height={16} />
      </div>
      <EditorColumns>
        <Card pad={20} gap={18}>
          <Skeleton width={70} height={20} />
          <div style={{ display: 'flex', gap: 16, alignItems: 'center' }}><Skeleton width={72} height={72} radius={36} /><Skeleton width="50%" /></div>
          <Skeleton height={150} radius={6} />
          <Skeleton height={33} radius={6} />
          <Skeleton height={88} radius={6} />
        </Card>
        {!mobile && <Skeleton width={340} height={700} radius={36} style={{ justifySelf: 'center' }} />}
      </EditorColumns>
    </Content>
  )
}
