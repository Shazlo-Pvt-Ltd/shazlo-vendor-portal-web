// The team works in IST, whatever the device's own time zone is.
const hourInIst = new Intl.DateTimeFormat('en-GB', { hour: 'numeric', hourCycle: 'h23', timeZone: 'Asia/Kolkata' })

export function partOfDay(now: Date = new Date()): 'morning' | 'afternoon' | 'evening' {
  const hour = Number(hourInIst.format(now))
  if (hour >= 5 && hour < 12) return 'morning'
  if (hour >= 12 && hour < 17) return 'afternoon'
  return 'evening'
}

// "5 h 20 m"; under an hour, "40 m". A missing median is a dash.
export function formatMinutes(minutes: number | null | undefined): string {
  if (minutes == null) return '—'
  const total = Math.round(minutes)
  const h = Math.floor(total / 60)
  const m = total % 60
  return h > 0 ? `${h} h ${m} m` : `${m} m`
}
