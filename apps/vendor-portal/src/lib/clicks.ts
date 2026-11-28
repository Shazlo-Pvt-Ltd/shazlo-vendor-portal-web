import type { MouseEvent } from 'react'

/**
 * For a submit button: the second click of a double click does not send the form again. Many
 * people double-click buttons; when the first send is already done (a fast answer), the second
 * would send an emptied form and replace the result with "Enter your …". Enter on the keyboard
 * (detail 0) and single clicks go through.
 */
export function ignoreRepeatClick(event: MouseEvent) {
  if (event.detail > 1) event.preventDefault()
}
