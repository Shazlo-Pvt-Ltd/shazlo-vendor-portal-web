import { afterEach, describe, expect, it, vi } from 'vitest'
import { reportModuleFailure, setModuleFailureReporter } from './moduleFailure'

afterEach(() => setModuleFailureReporter(undefined))

describe('reporting a module that could not be brought up', () => {
  it('tells nobody by default', () => {
    expect(() => reportModuleFailure({ moduleId: 'vendor-admin', reason: 'no_ready', attempts: 4 })).not.toThrow()
  })

  it('tells the registered reporter the module id, the reason and the count', () => {
    const reporter = vi.fn()
    setModuleFailureReporter(reporter)
    reportModuleFailure({ moduleId: 'vendor-admin', reason: 'no_ready', attempts: 4 })
    expect(reporter).toHaveBeenCalledWith({ moduleId: 'vendor-admin', reason: 'no_ready', attempts: 4 })
  })

  it('survives a reporter that throws, and stops telling a reporter that was removed', () => {
    setModuleFailureReporter(() => {
      throw new Error('tracker down')
    })
    expect(() => reportModuleFailure({ moduleId: 'm', reason: 'no_ready', attempts: 4 })).not.toThrow()
    const reporter = vi.fn()
    setModuleFailureReporter(reporter)
    setModuleFailureReporter(undefined)
    reportModuleFailure({ moduleId: 'm', reason: 'no_ready', attempts: 4 })
    expect(reporter).not.toHaveBeenCalled()
  })
})
