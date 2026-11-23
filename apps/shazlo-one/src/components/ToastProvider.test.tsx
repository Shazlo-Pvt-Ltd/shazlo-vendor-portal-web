import { act, fireEvent, render, screen, within } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { MAX_VISIBLE_TOASTS, ToastProvider, useToast, type ToastRequest } from './ToastProvider'

afterEach(() => {
  vi.useRealTimers()
})

let show: (toast: ToastRequest) => void = () => {}
function Capture() {
  show = useToast().show
  return null
}

function renderToasts() {
  render(
    <ToastProvider>
      <Capture />
    </ToastProvider>,
  )
  return { region: screen.getByRole('region', { name: 'Notifications' }) }
}
const push = (toast: ToastRequest) => act(() => show(toast))

describe('the shell’s toasts', () => {
  it('have a region that is always there and announces politely', () => {
    const { region } = renderToasts()
    expect(region.getAttribute('aria-live')).toBe('polite')
    expect(region.textContent).toBe('')
  })

  it.each(['info', 'success', 'warning', 'error'] as const)('show a %s toast with that severity, in the live region', (level) => {
    const { region } = renderToasts()
    push({ level, message: `A ${level} message.`, source: 'Vendor admin' })
    const toast = region.querySelector(`[data-level="${level}"]`)!
    expect(toast).not.toBeNull()
    expect(toast.textContent).toContain(`A ${level} message.`)
    expect(toast.textContent).toContain('Vendor admin')
    expect(toast.className).toMatch(new RegExp(`MuiAlert-(filled|standard)?${level[0]!.toUpperCase()}${level.slice(1)}|MuiAlert-color${level[0]!.toUpperCase()}${level.slice(1)}`))
  })

  it('announce politely, not assertively: no alert role, even for an error', () => {
    renderToasts()
    push({ level: 'error', message: 'It failed.' })
    expect(screen.queryByRole('alert')).toBeNull()
    expect(within(screen.getByRole('region', { name: 'Notifications' })).getByText('It failed.')).toBeTruthy()
  })

  it('show text, never HTML: markup in a message is displayed as characters and creates no element', () => {
    const { region } = renderToasts()
    const markup = '<img src=x onerror="alert(1)"><b>bold</b>'
    push({ level: 'info', message: markup, source: '<script>alert(2)</script>' })
    expect(region.textContent).toContain(markup)
    expect(region.textContent).toContain('<script>alert(2)</script>')
    expect(region.querySelector('img, b, script')).toBeNull()
    expect(region.innerHTML).not.toContain('<img')
  })

  it('keep line breaks and show a long message without overflowing the page', () => {
    const { region } = renderToasts()
    push({ level: 'info', message: 'one\ntwo' })
    expect(region.textContent).toContain('one')
    expect(region.textContent).toContain('two')
  })

  it('show at most three at once: a newer one pushes the oldest off', () => {
    const { region } = renderToasts()
    for (let n = 1; n <= 10; n += 1) push({ level: 'info', message: `message ${n}` })
    const shown = [...region.querySelectorAll('[data-level]')].map((node) => node.textContent)
    expect(shown).toHaveLength(MAX_VISIBLE_TOASTS)
    expect(shown.join(' ')).toContain('message 10')
    expect(shown.join(' ')).toContain('message 8')
    expect(shown.join(' ')).not.toContain('message 7')
  })

  it('go away by themselves: info after 6 s, error after 10 s', () => {
    vi.useFakeTimers()
    const { region } = renderToasts()
    push({ level: 'info', message: 'quick' })
    push({ level: 'error', message: 'slow' })
    act(() => void vi.advanceTimersByTime(5999))
    expect(region.textContent).toContain('quick')
    act(() => void vi.advanceTimersByTime(1))
    expect(region.textContent).not.toContain('quick')
    expect(region.textContent).toContain('slow')
    act(() => void vi.advanceTimersByTime(4000))
    expect(region.textContent).not.toContain('slow')
  })

  it('keep a sender’s duration within 3 to 15 seconds, so none can be gone at once or stay for ever', () => {
    vi.useFakeTimers()
    const { region } = renderToasts()
    push({ level: 'info', message: 'blink', durationMs: 1 })
    push({ level: 'info', message: 'forever', durationMs: 60_000 })
    act(() => void vi.advanceTimersByTime(2999))
    expect(region.textContent).toContain('blink')
    act(() => void vi.advanceTimersByTime(1))
    expect(region.textContent).not.toContain('blink')
    expect(region.textContent).toContain('forever')
    act(() => void vi.advanceTimersByTime(12_000))
    expect(region.textContent).not.toContain('forever')
  })

  it('can be closed by the admin', () => {
    const { region } = renderToasts()
    push({ level: 'warning', message: 'Heads up.' })
    fireEvent.click(within(region).getByRole('button', { name: /close/i }))
    expect(region.textContent).toBe('')
  })

  it('stop their timers when the shell goes away', () => {
    vi.useFakeTimers()
    const view = render(
      <ToastProvider>
        <Capture />
      </ToastProvider>,
    )
    push({ level: 'info', message: 'bye' })
    view.unmount()
    expect(() => vi.advanceTimersByTime(60_000)).not.toThrow()
  })

  it('refuse to be used outside the provider', () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {})
    expect(() => render(<Capture />)).toThrow(/inside ToastProvider/)
    spy.mockRestore()
  })
})
