import { cleanup } from '@testing-library/react'
import { afterEach } from 'vitest'

// Testing Library only cleans up by itself when the test globals are on; they are not.
afterEach(() => cleanup())

// jsdom has no object URLs; previews of a chosen file use them.
if (typeof URL.createObjectURL !== 'function') {
  let counter = 0
  URL.createObjectURL = () => `blob:test/${(counter += 1)}`
  URL.revokeObjectURL = () => {}
}
