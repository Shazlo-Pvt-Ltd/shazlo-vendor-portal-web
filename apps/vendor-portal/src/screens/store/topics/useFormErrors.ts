import { useEffect, useState } from 'react'
import type { FieldErrors } from '../../../lib/storeDetails'
import { ERROR_SUMMARY_ID } from './controls'
import { noErrors, orderErrors, settleErrors, showErrors, visibleErrors, type ShownErrors } from './model'

// The messages a form shows and its error summary (spec §8): `show` after Continue / Save found
// problems (and moves focus to the summary), `settle` on every change so fixed answers lose their
// message, `clear` when the form starts over.
export function useFormErrors(order: readonly string[]) {
  const [shown, setShown] = useState<ShownErrors>(noErrors)
  const [round, setRound] = useState(0)

  useEffect(() => {
    if (round > 0) document.getElementById(ERROR_SUMMARY_ID)?.focus()
  }, [round])

  const errors = visibleErrors(shown)
  return {
    errors,
    ordered: orderErrors(errors, order),
    show(client: FieldErrors, server: FieldErrors = {}, values?: unknown) {
      setShown(showErrors(client, server, values))
      setRound((r) => r + 1)
    },
    settle(live: FieldErrors, values: unknown) {
      setShown((s) => (Object.keys(s.client).length || Object.keys(s.server).length ? settleErrors(s, live, values) : s))
    },
    clear() {
      setShown(noErrors)
    },
  }
}
