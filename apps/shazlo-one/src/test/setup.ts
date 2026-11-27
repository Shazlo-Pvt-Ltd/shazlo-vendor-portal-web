import { cleanup, configure } from '@testing-library/react'
import { afterEach } from 'vitest'

// Screens are lazy chunks: the first one a test file opens can take a few seconds to load on a cold,
// busy machine, far longer than findBy's 1 s default. Waiting longer costs nothing when it is fast.
configure({ asyncUtilTimeout: 5000 })

// Testing Library only cleans up by itself when the test globals are on; they are not.
afterEach(() => cleanup())

// jsdom has no object URLs; previews of a chosen file use them.
if (typeof URL.createObjectURL !== 'function') {
  let counter = 0
  URL.createObjectURL = () => `blob:test/${(counter += 1)}`
  URL.revokeObjectURL = () => {}
}
