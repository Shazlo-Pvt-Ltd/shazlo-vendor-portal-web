import { Button, Dialog, DialogActions, DialogContent, DialogContentText, DialogTitle } from '@mui/material'
import { createContext, useCallback, useContext, useId, useMemo, useRef, useState, type ReactNode } from 'react'

export interface ConfirmOptions {
  title: string
  message: ReactNode
  confirmLabel?: string
  cancelLabel?: string
  /** Style the confirm button as dangerous (deleting, discarding). */
  destructive?: boolean
}

type Confirm = (options: ConfirmOptions) => Promise<boolean>

const ConfirmContext = createContext<Confirm | undefined>(undefined)

/**
 * `const confirm = useConfirm(); if (await confirm({ title, message })) …`. One dialog for the whole
 * app: focus goes to it, Escape and "Cancel" answer false, and focus returns to what opened it.
 */
export function ConfirmProvider({ children }: { children: ReactNode }) {
  const [options, setOptions] = useState<ConfirmOptions | undefined>()
  const resolver = useRef<((answer: boolean) => void) | undefined>(undefined)
  const titleId = useId()
  const messageId = useId()

  const confirm = useCallback<Confirm>((next) => {
    resolver.current?.(false)
    return new Promise<boolean>((resolve) => {
      resolver.current = resolve
      setOptions(next)
    })
  }, [])
  const answer = useCallback((value: boolean) => {
    resolver.current?.(value)
    resolver.current = undefined
    setOptions(undefined)
  }, [])
  const api = useMemo(() => confirm, [confirm])

  return (
    <ConfirmContext.Provider value={api}>
      {children}
      <Dialog open={options !== undefined} onClose={() => answer(false)} aria-labelledby={titleId} aria-describedby={messageId} fullWidth maxWidth="xs">
        <DialogTitle id={titleId}>{options?.title}</DialogTitle>
        <DialogContent>
          <DialogContentText id={messageId} component="div">
            {options?.message}
          </DialogContentText>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => answer(false)}>{options?.cancelLabel ?? 'Cancel'}</Button>
          <Button
            variant="contained"
            color={options?.destructive ? 'error' : 'primary'}
            onClick={() => answer(true)}
          >
            {options?.confirmLabel ?? 'Confirm'}
          </Button>
        </DialogActions>
      </Dialog>
    </ConfirmContext.Provider>
  )
}

export function useConfirm(): Confirm {
  const confirm = useContext(ConfirmContext)
  if (confirm === undefined) {
    throw new Error('useConfirm must be used inside ConfirmProvider.')
  }
  return confirm
}
