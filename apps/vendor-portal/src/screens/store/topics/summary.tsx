import { Box, Link, Typography } from '@mui/material'
import { neutral } from '@shazlo/ui'
import type { ReactNode } from 'react'
import { Link as RouterLink } from 'react-router'
import type { Schemas } from '../../../api/model'
import { catalogCopy } from '../../../copy/catalog'
import { storeCopy as copy } from '../../../copy/store'
import { formatBps } from '../../../lib/commission'
import { srOnly } from '../../../lib/a11y'
import { maskAccountNumber, normalisePhone } from '../../../lib/validators'

// Label / value rows for each topic, read back the same way on the Store details page (saved
// details, payouts masked) and on the sign-up "Check your answers" page (unsent answers).

export type Row = { key: string; label: string; value: ReactNode }

const r = copy.rows
const orNotAdded = (v: string | null | undefined) => (v && v.trim() ? v.trim() : r.notAdded)
const label = <T extends string | number>(labels: Partial<Record<T, string>>, v: T | null | undefined | '') =>
  v === null || v === undefined || v === '' ? r.notAnswered : (labels[v as T] ?? r.notAnswered)

// "9825012345" → "98250 12345".
export function formatPhone(raw: string): string {
  const d = normalisePhone(raw)
  return d ? `${d.slice(0, 5)} ${d.slice(5)}` : raw.trim()
}

// "HDFC Bank •••• 4821", or the masked UPI ID.
export function payoutLine(p: Schemas['Payout']): string {
  return p.method === 'bank' ? `${p.bank_name} ${maskAccountNumber(p.account_last4)}` : p.upi_id
}

export function brandRows(b: { brand_name: string; sells: Schemas['Sells'] | null | ''; city: string | null; instagram_or_website: string | null }, { storeName = true } = {}): Row[] {
  return [
    ...(storeName ? [{ key: 'brand_name', label: r.storeName, value: b.brand_name || r.notAnswered }] : []),
    { key: 'sells', label: r.sells, value: label(catalogCopy.sells, b.sells) },
    { key: 'city', label: r.city, value: b.city?.trim() || r.notAnswered },
    { key: 'instagram_or_website', label: r.link, value: orNotAdded(b.instagram_or_website) },
  ]
}

export function contactRows(c: Schemas['Contact']): Row[] {
  return [
    { key: 'name', label: r.name, value: c.name.trim() || r.notAnswered },
    { key: 'phone', label: r.phone, value: c.phone.trim() ? formatPhone(c.phone) : r.notAnswered },
    { key: 'email', label: r.email, value: c.email.trim() || r.notAnswered },
  ]
}

export function deliveryRows(d: Schemas['Delivery'] | { mode: '' }): Row[] {
  const rows: Row[] = [{ key: 'mode', label: r.deliveryMode, value: d.mode ? catalogCopy.delivery.modes[d.mode].label : r.notAnswered }]
  if (d.mode === 'shazlo') {
    const a = d.pickup_address
    const lines = [a.line1, a.area, [a.city, a.pin].filter(Boolean).join(' ')].map((l) => l.trim()).filter(Boolean)
    rows.push({ key: 'pickup_address', label: r.pickup, value: lines.length ? <Box component="span" sx={{ whiteSpace: 'pre-line' }}>{lines.join('\n')}</Box> : r.notAnswered })
  }
  if (d.mode === 'own') {
    const areas = d.areas.all_india ? catalogCopy.delivery.allIndia : d.areas.places.length ? d.areas.places.join(', ') : r.notAnswered
    rows.push({ key: 'areas', label: r.areas, value: areas })
    rows.push({ key: 'delivery_days', label: r.days, value: label(catalogCopy.delivery.days, d.delivery_days) })
  }
  return rows
}

export function returnsRows(x: Schemas['Returns'] | { window_days: null; condition: null; refund_days: null }): Row[] {
  const rows: Row[] = [{ key: 'window_days', label: r.window, value: label(catalogCopy.returns.windows, x.window_days) }]
  if (x.window_days) {
    rows.push({ key: 'condition', label: r.condition, value: label(catalogCopy.returns.conditions, x.condition) })
    rows.push({ key: 'refund_days', label: r.refund, value: label(catalogCopy.returns.refunds, x.refund_days) })
  }
  return rows
}

export function paymentRows(p: Schemas['PayOnDelivery']): Row[] {
  const chosen = [p.cash && catalogCopy.payOnDelivery.cash, p.upi && catalogCopy.payOnDelivery.upi].filter((v): v is string => Boolean(v))
  return [{ key: 'pay_on_delivery', label: r.payment, value: chosen.length ? chosen.join(', ') : r.notAnswered }]
}

export function payoutRows(p: Schemas['Payout'] | null): Row[] {
  if (!p) return [{ key: 'method', label: r.paidTo, value: r.notAnswered }]
  if (p.method === 'upi') return [{ key: 'upi_id', label: r.upi, value: p.upi_id }]
  return [
    { key: 'account_number', label: r.paidTo, value: payoutLine(p) },
    { key: 'holder_name', label: r.holder, value: p.holder_name },
    { key: 'ifsc', label: r.ifsc, value: p.ifsc },
  ]
}

export function businessRows(b: Schemas['BusinessDetails']): Row[] {
  return [
    { key: 'legal_name', label: r.legalName, value: orNotAdded(b.legal_name) },
    { key: 'gstin', label: r.gstin, value: orNotAdded(b.gstin) },
  ]
}

export function termsRows(t: { proposedBps: number | null; agreedTerms: boolean; agreedPriceRule: boolean }): Row[] {
  return [
    { key: 'commission', label: r.commission, value: t.proposedBps === null || Number.isNaN(t.proposedBps) ? r.noProposal : formatBps(t.proposedBps) },
    { key: 'agreed_terms', label: r.sellerTerms, value: t.agreedTerms ? r.agreed : r.notAnswered },
    { key: 'agreed_price_rule', label: r.priceRule, value: t.agreedPriceRule ? r.agreed : r.notAnswered },
  ]
}

// A change link for one row: a route, or a step of sign-up.
export type ChangeTo = { to: string } | { onClick: () => void }

// The rows as a description list. With `change`, every row gets its own Change link (sign-up's
// Check your answers); Store details puts one Change link on the card instead.
export function SummaryList({ rows, change }: { rows: readonly Row[]; change?: (row: Row) => ChangeTo }) {
  return (
    <Box component="dl" sx={{ m: 0 }}>
      {rows.map((row, i) => {
        const target = change?.(row)
        return (
          <Box
            key={row.key}
            sx={{
              display: 'grid',
              gridTemplateColumns: { xs: target ? 'minmax(0, 1fr) auto' : 'minmax(0, 1fr)', sm: target ? 'minmax(0, 2fr) minmax(0, 3fr) auto' : 'minmax(0, 2fr) minmax(0, 3fr)' },
              columnGap: 2,
              rowGap: 0.25,
              alignItems: 'baseline',
              py: 1.25,
              borderTop: i === 0 ? 0 : `1px solid ${neutral.line}`,
            }}
          >
            <Typography component="dt" variant="body2" color="text.secondary" sx={{ gridColumn: 1 }}>
              {row.label}
            </Typography>
            <Typography component="dd" variant="body1" sx={{ m: 0, gridColumn: { xs: '1 / -1', sm: 2 }, gridRow: { xs: 2, sm: 1 }, overflowWrap: 'anywhere' }}>
              {row.value}
            </Typography>
            {target && (
              <Box component="dd" sx={{ m: 0, gridColumn: { xs: 2, sm: 3 }, gridRow: 1, justifySelf: 'end' }}>
                <ChangeLink target={target} what={row.label} />
              </Box>
            )}
          </Box>
        )
      })}
    </Box>
  )
}

// "Change", with what it changes for screen readers ("Change Sells").
export function ChangeLink({ target, what }: { target: ChangeTo; what: string }) {
  const content = (
    <>
      {copy.change}
      <Box component="span" sx={srOnly}>
        {' '}
        {what}
      </Box>
    </>
  )
  const sx = { display: 'inline-flex', alignItems: 'center', minHeight: 44, minWidth: 44, justifyContent: 'flex-end', typography: 'body1' } as const
  return 'to' in target ? (
    <Link component={RouterLink} to={target.to} sx={sx}>
      {content}
    </Link>
  ) : (
    <Link component="button" type="button" onClick={target.onClick} sx={{ ...sx, verticalAlign: 'baseline' }}>
      {content}
    </Link>
  )
}
