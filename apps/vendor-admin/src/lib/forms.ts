import { useCallback, useLayoutEffect, useRef } from 'react'
import type { FieldError, UseFormRegisterReturn } from 'react-hook-form'

// Connects a React Hook Form field to an MUI TextField: the ref goes to the <input> (so focus
// moves to the first invalid field) and the error becomes the field's described-by text.
export function fieldProps(registration: UseFormRegisterReturn, error?: FieldError, hint?: string) {
  const { ref, ...rest } = registration
  return {
    ...rest,
    inputRef: ref,
    error: Boolean(error),
    helperText: error?.message ?? hint,
    fullWidth: true,
  }
}

// Required fields carry no asterisk (design rule); the input keeps `required` for assistive tech.
export const noAsterisk = { inputLabel: { required: false } } as const

// Puts focus on a refused field after a submit is refused, by the form or by the API. Call the returned
// function when a submit is refused. The fields are disabled while a form submits, and a disabled field
// cannot take focus, so the focus waits for the render that re-enables them; a layout effect places it in
// that same commit, before the message can be seen or read out without it. Only a refusal moves focus:
// later changes to the errors (the reviewer fixing one of two fields) never do.
export function useFocusOnRefusal(busy: boolean, focus: () => void) {
  const pending = useRef(false)
  useLayoutEffect(() => {
    if (busy || !pending.current) return
    pending.current = false
    focus()
  })
  return useCallback(() => {
    pending.current = true
  }, [])
}
