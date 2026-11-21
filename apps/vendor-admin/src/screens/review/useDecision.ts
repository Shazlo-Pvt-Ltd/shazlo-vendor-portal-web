import type { UseMutationResult } from '@tanstack/react-query'
import { useState } from 'react'
import { ApiError } from '../../api/http'
import type { components } from '../../api/schema'
import { useRuntime } from '../../runtime/runtime'

type S = components['schemas']
export type Outcome = { decision: S['Decision']['decision']; nextId: string | null }

const messageOf = (error: unknown) => (error instanceof ApiError ? error.message : 'Something went wrong on our side. Try again in a moment.')

// Runs approve and send back for a review page: remembers the outcome for the page's banner, tells the
// shell with a toast, and turns a 409 (someone else decided first) into a reload of the decided state.
export function useDecision({
  approve,
  reject,
  reload,
  toasts,
}: {
  approve: UseMutationResult<S['Decision'], Error, void>
  reject: UseMutationResult<S['Decision'], Error, S['RejectBody']>
  reload: () => void
  toasts: { approved: string; sentBack: string }
}) {
  const { toast } = useRuntime()
  const [outcome, setOutcome] = useState<Outcome | null>(null)
  const [conflict, setConflict] = useState(false)
  const [failure, setFailure] = useState<string | null>(null)

  const onConflict = () => {
    setConflict(true)
    reload()
  }

  const runApprove = () => {
    setFailure(null)
    approve.mutate(undefined, {
      onSuccess: (d) => {
        setOutcome({ decision: 'approved', nextId: d.next_id })
        toast('success', toasts.approved)
      },
      onError: (error) => {
        if (error instanceof ApiError && error.status === 409) onConflict()
        else setFailure(messageOf(error))
      },
    })
  }

  // Resolves when the dialog can close; throws field errors and other failures back to the dialog.
  const sendBack = async (body: S['RejectBody']) => {
    setFailure(null)
    try {
      const d = await reject.mutateAsync(body)
      setOutcome({ decision: 'rejected', nextId: d.next_id })
      toast('success', toasts.sentBack)
    } catch (error) {
      if (error instanceof ApiError && error.status === 409) return onConflict()
      throw error
    }
  }

  return { outcome, conflict, failure, approving: approve.isPending, approve: runApprove, sendBack }
}
