import type { UserEvent } from '@testing-library/user-event'

/**
 * Puts `text` into a field as one paste instead of one keystroke at a time. Typing a hundred
 * characters through MUI is slow enough to time out on a busy CI runner (coverage makes it slower),
 * and a test that times out keeps typing into the next test. Use `user.type` only when the
 * keystrokes themselves are under test.
 */
export async function typeFast(user: Pick<UserEvent, 'click' | 'paste'>, element: Element, text: string): Promise<void> {
  await user.click(element)
  await user.paste(text)
}
