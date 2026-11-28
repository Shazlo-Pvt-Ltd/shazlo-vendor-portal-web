import { useEffect, useState } from 'react'
import type { FieldErrors } from '../../../lib/storeDetails'
import { ERROR_SUMMARY_ID } from './controls'
import { fieldId, noErrors, orderErrors, settleErrors, showErrors, visibleErrors, type ShownErrors } from './model'

// Where focus goes when Continue / Save finds problems: the error summary (Store details), or the
// first answer with a problem, which reads out its own message (sign-up). With no field for that
// answer on the page, the summary.
export type ErrorFocus = 'summary' | 'first'

// The messages a form shows and its error summary (spec §8): `show` after Continue / Save found
// problems (and moves focus), `settle` on every change so fixed answers lose their message, `clear`
// when the form starts over.
export function useFormErrors(order: readonly string[], { focus = 'summary' }: { focus?: ErrorFocus } = {}) {
  const [shown, setShown] = useState<ShownErrors>(noErrors)
  // Each `show` is a new request to move focus, with the answer it goes to.
  const [request, setRequest] = useState<{ round: number; first: string | null }>({ round: 0, first: null })

  useEffect(() => {
    if (request.round === 0) return
    const field = focus === 'first' && request.first ? document.getElementById(fieldId(request.first)) : null
    ;(field ?? document.getElementById(ERROR_SUMMARY_ID))?.focus()
    // Clear of the sticky footer on phones.
    field?.scrollIntoView?.({ block: 'center' })
  }, [request, focus])

  const errors = visibleErrors(shown)
  return {
    errors,
    ordered: orderErrors(errors, order),
    // `pageOrder`: the order of the page being shown, when it is not this one yet (sign-up moving
    // to another step with problems on it).
    show(client: FieldErrors, server: FieldErrors = {}, values?: unknown, pageOrder: readonly string[] = order) {
      const next = showErrors(client, server, values)
      setShown(next)
      setRequest((r) => ({ round: r.round + 1, first: orderErrors(visibleErrors(next), pageOrder)[0]?.[0] ?? null }))
    },
    settle(live: FieldErrors, values: unknown) {
      setShown((s) => (Object.keys(s.client).length || Object.keys(s.server).length ? settleErrors(s, live, values) : s))
    },
    clear() {
      setShown(noErrors)
    },
  }
}
