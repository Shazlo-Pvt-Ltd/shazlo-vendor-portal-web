import { z } from 'zod'
import { moduleIcon, modulePath } from './manifest'

// ADR 0011: the summary a module's backend may serve, in one shape for every module. The shell
// reads it with the module's own token and draws it the same way for each: the badge on the
// module's row in the sidebar, and cards on Home with a few figures that link into the module,
// then the module's latest activity. The shell never learns what the figures mean.
//
// A summary that cannot be read (down, slow, invalid) shows no badge and an error on that module's
// card only, never a 0: a 0 would tell an admin there is nothing to do.
//
// Optional fields accept null as well as a missing key: a FastAPI backend sends `null` for `None`.

const text = (max: number) => z.string().trim().min(1).max(max)
const link = z.object({ label: text(40), path: modulePath })

const figure = z.object({
  label: text(60),
  // Null when the backend cannot count it right now; the shell shows a dash, not a 0.
  value: z.number().int().nonnegative().nullable(),
  unit: z.enum(['count', 'minutes']).default('count'),
  hint: text(120).nullish(),
  path: modulePath.nullish(),
})

const section = z.object({
  title: text(60),
  icon: moduleIcon.nullish(),
  action: link.nullish(),
  alert: z.object({ tone: z.enum(['warning', 'error']), text: text(200), action: link.nullish() }).nullish(),
  figures: z.array(figure).min(1).max(4),
})

const activityItem = z.object({
  id: text(100),
  title: text(200),
  // A second line: where the item belongs and what kind it is ("Kalki Studio · Product").
  subtitle: text(200).nullish(),
  // Positive reads as done or approved; attention as sent back or needing a look.
  status: z.object({ tone: z.enum(['positive', 'attention']), label: text(30) }),
  at: z.iso.datetime({ offset: true }),
  // The identity-api admin who acted; the shell asks identity-api for the name. Null when the
  // backend never recorded who it was; a missing key when the module does not track people. An id
  // that is not a UUID reads as null ("a former admin"): a name is not worth losing the summary for.
  actor_id: z.uuid().nullish().catch(null),
  path: modulePath.nullish(),
})

const activity = z.object({
  title: text(60),
  icon: moduleIcon.nullish(),
  empty: z.object({ title: text(60), body: text(200).nullish() }),
  items: z.array(activityItem).max(10),
})

export const moduleSummarySchema = z.object({
  v: z.literal(1),
  // Null: nothing for the badge (the module has nothing waiting, or does not count it).
  badge: z.object({ count: z.number().int().nonnegative(), label: text(40) }).nullable(),
  sections: z.array(section).max(3),
  activity: activity.nullish(),
})

export type ModuleSummary = z.infer<typeof moduleSummarySchema>
export type SummarySection = ModuleSummary['sections'][number]
export type SummaryFigure = SummarySection['figures'][number]
export type SummaryActivity = NonNullable<ModuleSummary['activity']>
export type SummaryActivityItem = SummaryActivity['items'][number]

// Null when the summary is not valid. Unknown fields are dropped, so a newer backend still reads.
export function parseSummary(raw: unknown): ModuleSummary | null {
  const parsed = moduleSummarySchema.safeParse(raw)
  return parsed.success ? parsed.data : null
}

// The badge to draw for a summary request's outcome: a count only from a summary that was read.
export function badgeOf(summary: ModuleSummary | null | undefined): { count: number; label: string } | null {
  if (!summary?.badge || summary.badge.count === 0) return null
  return summary.badge
}

// The identity-api admins a summary names, once each: what the shell asks identity-api for.
export function actorIds(summary: ModuleSummary | null | undefined): string[] {
  return [...new Set((summary?.activity?.items ?? []).flatMap((item) => (item.actor_id ? [item.actor_id] : [])))]
}
