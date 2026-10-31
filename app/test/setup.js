import { cleanup } from '@testing-library/react'
import { afterEach, beforeEach, vi } from 'vitest'

beforeEach(() => {
  localStorage.clear()
  // An omitted fetch stub is a failure, never a request to a live Shazlo API.
  vi.stubGlobal('fetch', vi.fn(() => Promise.reject(new Error('Unexpected network request in test'))))
})

afterEach(() => {
  cleanup()
  vi.useRealTimers()
})
