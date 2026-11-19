import { Chip } from '@mui/material'
import { act, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { ApiError, NetworkError } from '../api/errors'
import { ConfirmProvider, EmptyState, ErrorState, LoadingState, PageHeader, PageSkeleton, ToastProvider, useConfirm, useToast } from '.'
import { FocusRequestContext } from './PageHeader'

describe('PageHeader', () => {
  it('is the one h1, sets the page title and shows the description and actions', () => {
    render(<PageHeader title="Products" description="Everything you sell." actions={<button>Add product</button>} />)
    expect(screen.getAllByRole('heading', { level: 1 })).toHaveLength(1)
    expect(screen.getByRole('heading', { level: 1, name: 'Products' })).toBeTruthy()
    expect(document.title).toBe('Products · Shazlo Vendor Portal')
    expect(screen.getByText('Everything you sell.')).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Add product' })).toBeTruthy()
  })

  it('keeps a text description a paragraph, and puts anything else where a chip may go', () => {
    const error = vi.spyOn(console, 'error')
    render(<PageHeader title="Products" description="Everything you sell." />)
    expect(screen.getByText('Everything you sell.').tagName).toBe('P')
    // A Chip's root is a <div>, which a <p> cannot hold: React warns, and the HTML is invalid.
    const { container } = render(
      <PageHeader
        title="Kurta"
        description={
          <span>
            SKU K-1 <Chip size="small" label="Draft" />
          </span>
        }
      />,
    )
    expect(screen.getByText('Draft')).toBeTruthy()
    expect(container.querySelector('p div, p p')).toBeNull()
    expect(error).not.toHaveBeenCalled()
  })

  it('takes focus once when the shell asked for it, and not otherwise', () => {
    function Probe({ asked }: { asked: boolean }) {
      return (
        <FocusRequestContext.Provider value={() => asked}>
          <PageHeader title="Asked" />
        </FocusRequestContext.Provider>
      )
    }
    const { unmount } = render(<Probe asked={false} />)
    expect(document.activeElement).toBe(document.body)
    unmount()
    render(<Probe asked />)
    expect(document.activeElement).toBe(screen.getByRole('heading', { level: 1, name: 'Asked' }))
  })
})

describe('the loading, empty and error states', () => {
  it('says it is loading, politely, and busy', () => {
    render(<LoadingState label="Loading products…" />)
    const status = screen.getByRole('status')
    expect(status.getAttribute('aria-busy')).toBe('true')
    expect(status.textContent).toContain('Loading products…')
  })

  it('has a page skeleton that is announced', () => {
    render(<PageSkeleton />)
    expect(screen.getByRole('status', { name: 'Loading the page' })).toBeTruthy()
  })

  it('says what is empty and what to do', async () => {
    const onAdd = vi.fn()
    render(<EmptyState title="No products yet" description="Add your first product." action={<button onClick={onAdd}>Add a product</button>} />)
    expect(screen.getByRole('heading', { level: 2, name: 'No products yet' })).toBeTruthy()
    await userEvent.click(screen.getByRole('button', { name: 'Add a product' }))
    expect(onAdd).toHaveBeenCalled()
  })

  it('shows a plain sentence, Try again, and the request id, never the raw error', async () => {
    const retry = vi.fn()
    const error = new ApiError({ status: 500, code: 'internal_error', message: 'psycopg2.OperationalError: connection refused', requestId: 'req-42' })
    render(<ErrorState error={error} onRetry={retry} />)
    const alert = screen.getByRole('alert')
    expect(alert.textContent).toContain('Something went wrong on our side')
    expect(alert.textContent).toContain('req-42')
    expect(alert.textContent).not.toMatch(/psycopg2|internal_error|500/)
    await userEvent.click(screen.getByRole('button', { name: 'Try again' }))
    expect(retry).toHaveBeenCalled()
  })

  it('words a network failure and omits the reference when there is none', () => {
    render(<ErrorState error={new NetworkError('network')} title="We couldn't load products" />)
    expect(screen.getByRole('alert').textContent).toMatch(/Could not reach the server/)
    expect(screen.getByRole('alert').textContent).not.toMatch(/reference/)
    expect(screen.queryByRole('button', { name: 'Try again' })).toBeNull()
  })
})

describe('toasts', () => {
  function Buttons() {
    const toast = useToast()
    return (
      <>
        <button onClick={() => toast.success('Product saved')}>ok</button>
        <button onClick={() => toast.error('Could not save')}>fail</button>
        <button onClick={() => { toast.success('First'); toast.success('Second') }}>two</button>
      </>
    )
  }
  const open = () => render(<ToastProvider><Buttons /></ToastProvider>)

  it('announces a success politely and a failure assertively', async () => {
    open()
    await userEvent.click(screen.getByText('ok'))
    expect((await screen.findByText('Product saved')).closest('[role]')?.getAttribute('role')).toBe('status')
    await userEvent.click(screen.getByText('fail'))
    // Messages are shown one at a time: dismiss the success to reach the failure.
    await userEvent.click(screen.getByRole('button', { name: 'Close' }))
    await waitFor(() => expect(screen.getByText('Could not save').closest('[role]')?.getAttribute('role')).toBe('alert'))
  })

  it('shows messages one at a time, in order, and can be dismissed', async () => {
    open()
    await userEvent.click(screen.getByText('two'))
    expect(await screen.findByText('First')).toBeTruthy()
    expect(screen.queryByText('Second')).toBeNull()
    await userEvent.click(screen.getByRole('button', { name: 'Close' }))
    expect(await screen.findByText('Second')).toBeTruthy()
  })

  it('needs its provider', () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {})
    expect(() => render(<Buttons />)).toThrow(/ToastProvider/)
    spy.mockRestore()
  })
})

describe('the confirmation dialog', () => {
  function Ask({ onAnswer }: { onAnswer: (answer: boolean) => void }) {
    const confirm = useConfirm()
    return (
      <button
        onClick={async () => onAnswer(await confirm({ title: 'Delete this product?', message: 'This cannot be undone.', confirmLabel: 'Delete', destructive: true }))}
      >
        ask
      </button>
    )
  }
  const open = (onAnswer: (answer: boolean) => void) => render(<ConfirmProvider><Ask onAnswer={onAnswer} /></ConfirmProvider>)

  it('answers true on confirm', async () => {
    const answer = vi.fn()
    open(answer)
    await userEvent.click(screen.getByText('ask'))
    const dialog = await screen.findByRole('dialog', { name: 'Delete this product?' })
    expect(dialog.textContent).toContain('This cannot be undone.')
    await userEvent.click(screen.getByRole('button', { name: 'Delete' }))
    await waitFor(() => expect(answer).toHaveBeenCalledWith(true))
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
  })

  it('answers false on Cancel and on Escape', async () => {
    const answer = vi.fn()
    open(answer)
    await userEvent.click(screen.getByText('ask'))
    await userEvent.click(await screen.findByRole('button', { name: 'Cancel' }))
    await waitFor(() => expect(answer).toHaveBeenLastCalledWith(false))
    await userEvent.click(screen.getByText('ask'))
    await screen.findByRole('dialog')
    await userEvent.keyboard('{Escape}')
    await waitFor(() => expect(answer).toHaveBeenCalledTimes(2))
    expect(answer).toHaveBeenLastCalledWith(false)
  })

  it('resolves an earlier question as false when a new one is asked', async () => {
    const answers: boolean[] = []
    function Twice() {
      const confirm = useConfirm()
      return <button onClick={() => { void confirm({ title: 'One', message: 'm' }).then((a) => answers.push(a)); void confirm({ title: 'Two', message: 'm' }) }}>go</button>
    }
    render(<ConfirmProvider><Twice /></ConfirmProvider>)
    await act(async () => { await userEvent.click(screen.getByText('go')) })
    await screen.findByRole('dialog', { name: 'Two' })
    expect(answers).toEqual([false])
  })
})
