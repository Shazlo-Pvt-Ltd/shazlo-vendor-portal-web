// A-06 "Send back (reason required)". The same dialog is used to send back a brand page (A-07),
// reject or ask a vendor application for more info (A-09) and suspend a vendor (A-08, A-09).
import MuiDialog from '@mui/material/Dialog'
import { styled } from '@mui/material/styles'
import { useEffect, useId, useRef, useState, type ReactNode } from 'react'
import { Button, Icon, IconButton, kit, Text, TextArea, textStyle, type IconName } from '@shazlo/ui/components'
import { PHONE, useIsPhone } from './ui'

export const MIN_MESSAGE = 10
export const MAX_MESSAGE = 500

export interface ReasonTemplate {
  label: string
  /** Suggested message, filled in when the message box is still empty. */
  text?: string
}

const Chip = styled('button', { shouldForwardProp: p => p !== 'on' })<{ on: boolean }>(({ on }) => ({
  display: 'inline-flex',
  alignItems: 'center',
  gap: 6,
  padding: on ? '5px 11px 5px 9px' : '5px 11px',
  minHeight: 28,
  borderRadius: 999,
  border: `1px solid ${on ? kit.ink : kit.field}`,
  background: on ? kit.ink : kit.surface,
  color: on ? kit.offWhite : kit.ink,
  ...textStyle.small,
  cursor: 'pointer',
  whiteSpace: 'nowrap',
  transition: 'background-color 150ms ease-out, color 150ms ease-out',
  '&:hover': on ? {} : { background: '#FBF4E2' },
  '&:focus-visible': { outline: `2px solid ${kit.focus}`, outlineOffset: 2 },
}))

/** Hint, Cancel and confirm. On phones it sits at the bottom of the full-screen dialog, buttons sharing the row. */
const Footer = styled('div')({
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'flex-end',
  gap: 8,
  flexWrap: 'wrap',
  [PHONE]: {
    marginTop: 'auto',
    '& > .hint': { flex: '1 1 100%' },
    '& > button': { flex: '1 1 auto' },
  },
})

export function ReasonDialog({
  open, onClose, title, subtitle, templates, reasonLabel = 'Reason', messageLabel = 'Message to the vendor (required)',
  helper = 'Shown to the vendor exactly as written', consequence, confirmLabel, confirmIcon = 'x', pending, error, onConfirm,
}: {
  open: boolean
  onClose: () => void
  title: string
  subtitle?: ReactNode
  templates?: ReasonTemplate[]
  reasonLabel?: string
  messageLabel?: string
  helper?: string
  consequence?: ReactNode
  confirmLabel: string
  confirmIcon?: IconName
  pending?: boolean
  error?: string | null
  onConfirm: (value: { reasons: string[]; message: string }) => void
}) {
  const titleId = useId()
  const hintId = useId()
  const [reasons, setReasons] = useState<string[]>([])
  const [message, setMessage] = useState('')
  const textRef = useRef<HTMLTextAreaElement>(null)
  const phone = useIsPhone()

  // Start clean each time the dialog opens.
  useEffect(() => {
    if (open) { setReasons([]); setMessage('') }
  }, [open])

  const length = message.trim().length
  const ready = length >= MIN_MESSAGE && !pending

  const toggle = (t: ReasonTemplate) => {
    const on = reasons.includes(t.label)
    setReasons(on ? reasons.filter(r => r !== t.label) : [...reasons, t.label])
    if (!on && t.text && !message.trim()) {
      setMessage(t.text)
      requestAnimationFrame(() => textRef.current?.focus())
    }
  }

  return (
    <MuiDialog
      open={open}
      onClose={pending ? undefined : onClose}
      aria-labelledby={titleId}
      fullScreen={phone}
      slotProps={{
        paper: {
          sx: phone
            ? { background: kit.surface }
            : { width: 560, maxWidth: 'calc(100vw - 32px)', m: 2, background: kit.surface, borderRadius: '12px', boxShadow: '0 24px 48px rgba(16, 60, 100, 0.25)' },
        },
        backdrop: { sx: { background: 'rgba(16, 60, 100, 0.55)' } },
      }}
    >
      <form
        onSubmit={e => { e.preventDefault(); if (ready) onConfirm({ reasons, message: message.trim() }) }}
        style={{ display: 'flex', flexDirection: 'column', gap: 18, padding: phone ? '16px 16px 24px' : 24, flex: phone ? 1 : undefined }}
      >
        <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 12 }}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 4, minWidth: 0 }}>
            <Text v="heading" as="h2" id={titleId}>{title}</Text>
            {subtitle && <Text v="small" tone="muted" as="p">{subtitle}</Text>}
          </div>
          <IconButton type="button" aria-label="Close" onClick={onClose} disabled={pending} style={{ margin: '-7px -7px 0 0' }}>
            <Icon name="x" size={18} color={kit.ink} />
          </IconButton>
        </div>

        {templates && templates.length > 0 && (
          <fieldset style={{ border: 0, padding: 0, margin: 0, display: 'flex', flexDirection: 'column', gap: 8, minWidth: 0 }}>
            <legend style={{ ...textStyle.label, color: kit.ink, padding: 0, marginBottom: 8 }}>{reasonLabel}</legend>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
              {templates.map(t => {
                const on = reasons.includes(t.label)
                return (
                  <Chip key={t.label} type="button" on={on} aria-pressed={on} onClick={() => toggle(t)}>
                    {on && <Icon name="check" size={14} />}
                    {t.label}
                  </Chip>
                )
              })}
            </div>
          </fieldset>
        )}

        <TextArea
          ref={textRef}
          label={messageLabel}
          value={message}
          maxLength={MAX_MESSAGE}
          rows={3}
          onChange={e => setMessage(e.target.value)}
          helper={`${helper} · ${message.length} / ${MAX_MESSAGE}`}
          error={error ?? undefined}
          required
          aria-required
          style={{ minWidth: 0 }}
        />

        {consequence && (
          <div style={{ display: 'flex', gap: 8, padding: '10px 12px', background: kit.chip, borderRadius: 8 }}>
            <Icon name="info" size={16} color={kit.ink} />
            <Text v="small" tone="muted" as="p" style={{ flex: 1, minWidth: 0 }}>{consequence}</Text>
          </div>
        )}

        <Footer>
          {!ready && !pending && (
            <Text v="caption" tone="subtle" id={hintId} className="hint" style={{ marginRight: 'auto' }}>
              {length === 0 ? 'Write a message to send this.' : `Write at least ${MIN_MESSAGE} characters (${length} so far).`}
            </Text>
          )}
          <Button variant="ghost" onClick={onClose} disabled={pending}>Cancel</Button>
          <Button type="submit" variant="primary" icon={confirmIcon} disabled={!ready} aria-describedby={!ready && !pending ? hintId : undefined}>
            {pending ? 'Saving…' : confirmLabel}
          </Button>
        </Footer>
      </form>
    </MuiDialog>
  )
}
