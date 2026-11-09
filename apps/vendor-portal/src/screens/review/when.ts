// Date wording used on V-09: "today, 11:40", "yesterday", "18 Oct, 16:20", "waiting 19 h".
const time = new Intl.DateTimeFormat('en-IN', { hour: '2-digit', minute: '2-digit', hour12: false })
const dayMonth = new Intl.DateTimeFormat('en-IN', { day: 'numeric', month: 'short' })

const startOfDay = (ms: number) => { const d = new Date(ms); d.setHours(0, 0, 0, 0); return d.getTime() }

export const clock = (iso: string) => time.format(new Date(iso))

/** "today, 11:40" · "yesterday" · "21 Oct" (or "18 Oct, 16:20" with `olderWithTime`). */
export function when(iso: string, { olderWithTime = false, now = Date.now() } = {}) {
  const t = Date.parse(iso)
  const today = startOfDay(now)
  if (t >= today) return `today, ${clock(iso)}`
  if (t >= today - 86_400_000) return 'yesterday'
  return olderWithTime ? `${dayMonth.format(new Date(t))}, ${clock(iso)}` : dayMonth.format(new Date(t))
}

/** Time spent waiting: "19 h" / "19 hours", "40 min", "3 days". */
export function waited(iso: string, { long = false, now = Date.now() } = {}) {
  const ms = Math.max(0, now - Date.parse(iso))
  const min = Math.floor(ms / 60_000)
  const h = Math.floor(ms / 3_600_000)
  if (h < 1) return long ? `${Math.max(1, min)} ${min === 1 ? 'minute' : 'minutes'}` : `${Math.max(1, min)} min`
  if (h < 48) return long ? `${h} ${h === 1 ? 'hour' : 'hours'}` : `${h} h`
  const d = Math.floor(h / 24)
  return `${d} days`
}
