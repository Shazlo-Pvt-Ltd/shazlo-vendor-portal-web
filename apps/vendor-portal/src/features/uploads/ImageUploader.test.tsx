import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { ApiError } from '../../api/errors'
import { ImageUploader } from './ImageUploader'
import { assetOut, deferred, fakeDeps, image } from '../../api/uploads/testing'

// `applyAccept: false` lets a test hand the input a file its `accept` list would have hidden: a drag
// and drop, or a browser that ignores `accept`, can do exactly that, so the code must refuse it itself.
const setup = () => userEvent.setup({ applyAccept: false })
const fileInput = (name: RegExp = /choose/) => screen.getByLabelText(name) as HTMLInputElement

function renderUploader(props: Partial<React.ComponentProps<typeof ImageUploader>> = {}) {
  const { deps, calls } = fakeDeps()
  const onUploaded = vi.fn()
  render(<ImageUploader kind="brand_logo" label="Brand logo" onUploaded={onUploaded} deps={deps} {...props} />)
  return { calls, onUploaded, user: setup() }
}

describe('uploading a logo', () => {
  it('shows the image before it is saved, then from the image host once registered', async () => {
    const send = deferred()
    const { deps } = fakeDeps({ send: async (_s, _f, { onProgress }) => { onProgress(0.4); await send.promise } })
    const onUploaded = vi.fn()
    render(<ImageUploader kind="brand_logo" label="Brand logo" onUploaded={onUploaded} deps={deps} />)
    await setup().upload(fileInput(), image('logo.png'))

    // While it uploads: the local preview, not yet the host's address.
    const row = await screen.findByRole('listitem')
    await waitFor(() => expect(within(row).getByText(/Uploading… 40%/)).toBeTruthy())
    const preview = row.querySelector('img')!
    expect(preview.getAttribute('src')).toMatch(/^blob:/)

    send.resolve()
    await waitFor(() => expect(within(row).getByText('Uploaded')).toBeTruthy())
    expect(row.querySelector('img')!.getAttribute('src')).toBe(assetOut().url)
    expect(row.querySelector('img')!.getAttribute('referrerpolicy')).toBe('no-referrer')
    expect(onUploaded).toHaveBeenCalledWith(expect.objectContaining({ id: assetOut().id, status: 'ready' }), expect.any(File))
  })

  it('replaces the old file when a new one is chosen (a logo is one image)', async () => {
    const { user } = renderUploader()
    await user.upload(fileInput(), image('one.png'))
    await screen.findByText('one.png')
    await screen.findByText('Uploaded')
    await user.upload(fileInput(), image('two.png'))
    await screen.findByText('two.png')
    await waitFor(() => expect(screen.queryByText('one.png')).toBeNull())
    expect(screen.getAllByRole('listitem')).toHaveLength(1)
  })

  it('shows the saved image from the draft until a new one is chosen, safely', async () => {
    const { rerender } = render(<ImageUploader kind="brand_logo" label="Brand logo" currentUrl="https://res.cloudinary.com/x/logo.jpg" onUploaded={() => {}} />)
    expect(screen.getByRole('img', { name: 'Current logo' }).getAttribute('src')).toBe('https://res.cloudinary.com/x/logo.jpg')
    rerender(<ImageUploader kind="brand_logo" label="Brand logo" currentUrl="javascript:alert(1)" onUploaded={() => {}} />)
    expect(screen.queryByRole('img')).toBeNull()
  })
})

describe('refusing a file before any request leaves the browser', () => {
  it.each([
    ['the wrong type', () => image('anim.gif', 'image/gif'), /not accepted.*Use a JPG, PNG or WebP under 10 MB/],
    ['a file that is too large', () => image('huge.png', 'image/png', 10 * 1024 * 1024 + 1), /too large.*under 10 MB/],
  ])('says so for %s, sends nothing, and ties the message to the control', async (_name, make, message) => {
    const { calls, onUploaded, user } = renderUploader()
    await user.upload(fileInput(), make())
    const alert = await screen.findByRole('alert')
    expect(alert.textContent).toMatch(message)
    expect(calls).toEqual([])
    expect(onUploaded).not.toHaveBeenCalled()
    const button = screen.getByRole('button', { name: /Choose a (different )?logo/ })
    expect(button.getAttribute('aria-describedby')!.split(' ')).toContain(alert.id)
  })

  it('also refuses a dropped file of the wrong type', async () => {
    const { calls } = renderUploader()
    const zone = screen.getByRole('button', { name: /Choose a logo/ }).parentElement!
    fireEvent.drop(zone, { dataTransfer: { files: [image('x.pdf', 'application/pdf')] } })
    expect((await screen.findByRole('alert')).textContent).toMatch(/not accepted/)
    expect(calls).toEqual([])
  })
})

describe('cancel and retry', () => {
  it('cancelling stops the upload, registers nothing and reports nothing as uploaded', async () => {
    const started = deferred()
    const { deps, calls } = fakeDeps({
      send: async (_s, _f, { signal }) => {
        started.resolve()
        await new Promise((_, reject) => signal.addEventListener('abort', () => reject(new DOMException('x', 'AbortError'))))
      },
    })
    const onUploaded = vi.fn()
    render(<ImageUploader kind="brand_logo" label="Brand logo" onUploaded={onUploaded} deps={deps} />)
    const user = setup()
    await user.upload(fileInput(), image('logo.png'))
    await started.promise
    await user.click(await screen.findByRole('button', { name: 'Cancel upload of logo.png' }))
    await waitFor(() => expect(screen.getByText('Cancelled')).toBeTruthy())
    expect(calls).not.toContain('register')
    expect(onUploaded).not.toHaveBeenCalled()
    expect(screen.queryByRole('alert')).toBeNull()
  })

  it('offers Try again after a failure that can be retried, and succeeds the second time', async () => {
    let tries = 0
    const { deps } = fakeDeps({
      register: async () => { tries += 1; if (tries === 1) throw new ApiError({ status: 500, code: 'internal_error', message: 'x' }); return assetOut() },
    })
    const onUploaded = vi.fn()
    render(<ImageUploader kind="brand_logo" label="Brand logo" onUploaded={onUploaded} deps={deps} />)
    const user = setup()
    await user.upload(fileInput(), image('logo.png'))
    expect((await screen.findByRole('alert')).textContent).toMatch(/could not be saved/)
    await user.click(screen.getByRole('button', { name: 'Try again: logo.png' }))
    await screen.findByText('Uploaded')
    expect(onUploaded).toHaveBeenCalledTimes(1)
  })

  it('offers no Try again when retrying cannot help, and shows the server\'s reason', async () => {
    const { deps } = fakeDeps({ register: async () => { throw new ApiError({ status: 422, code: 'image_too_large', message: 'The image is larger than 10 MB' }) } })
    render(<ImageUploader kind="brand_logo" label="Brand logo" onUploaded={() => {}} deps={deps} />)
    await setup().upload(fileInput(), image('logo.png'))
    expect((await screen.findByRole('alert')).textContent).toBe('The image is larger than 10 MB')
    expect(screen.queryByRole('button', { name: /Try again/ })).toBeNull()
    expect(screen.getByRole('button', { name: 'Remove logo.png from the list' })).toBeTruthy()
  })

  it('shows an expired signature as a normal upload, because it was replaced automatically', async () => {
    let sends = 0
    const { deps, calls } = fakeDeps({ send: async () => { sends += 1; if (sends === 1) { const { UploadRejected } = await import('../../api/uploads/upload'); throw new UploadRejected(401) } } })
    render(<ImageUploader kind="brand_logo" label="Brand logo" onUploaded={() => {}} deps={deps} />)
    await setup().upload(fileInput(), image('logo.png'))
    await screen.findByText('Uploaded')
    expect(calls.filter((c) => c === 'sign')).toHaveLength(2)
    expect(screen.queryByRole('alert')).toBeNull()
  })
})

describe('several product images at once', () => {
  it('uploads two at a time, shows each file\'s own status, and finishes them all', async () => {
    const gates = Array.from({ length: 5 }, () => deferred())
    let active = 0
    let peak = 0
    let n = 0
    const { deps } = fakeDeps({
      send: async () => {
        const mine = n++
        active += 1
        peak = Math.max(peak, active)
        await gates[mine]!.promise
        active -= 1
      },
    })
    const onUploaded = vi.fn()
    render(<ImageUploader kind="product_image" label="Product images" multiple onUploaded={onUploaded} deps={deps} />)
    await setup().upload(fileInput(), [1, 2, 3, 4, 5].map((i) => image(`p${i}.jpg`, 'image/jpeg')))

    await waitFor(() => expect(peak).toBe(2))
    expect(screen.getAllByRole('listitem')).toHaveLength(5)
    expect(screen.getAllByText('Waiting…')).toHaveLength(3)
    expect(screen.getAllByText(/Uploading…/)).toHaveLength(2)

    for (const gate of gates) {
      gate.resolve()
      await new Promise((r) => setTimeout(r, 5))
    }
    await waitFor(() => expect(screen.getAllByText('Uploaded')).toHaveLength(5))
    expect(peak).toBe(2)
    expect(onUploaded).toHaveBeenCalledTimes(5)
  })

  it('lets one fail without stopping the others', async () => {
    let n = 0
    const { deps } = fakeDeps({ register: async () => { n += 1; if (n === 2) throw new ApiError({ status: 422, code: 'invalid_upload', message: 'The uploaded file could not be verified' }); return assetOut() } })
    render(<ImageUploader kind="product_image" label="Product images" multiple onUploaded={() => {}} deps={deps} />)
    await setup().upload(fileInput(), [image('a.jpg', 'image/jpeg'), image('b.jpg', 'image/jpeg'), image('c.jpg', 'image/jpeg')])
    await waitFor(() => expect(screen.getAllByText('Uploaded')).toHaveLength(2))
    expect(screen.getAllByRole('alert')).toHaveLength(1)
  })

  it('accepts several files in the file chooser and by drop', async () => {
    renderUploader({ kind: 'product_image', multiple: true, label: 'Product images' })
    expect(fileInput().multiple).toBe(true)
    expect(screen.getByRole('button', { name: 'Choose images' })).toBeTruthy()
  })
})

describe('accessibility', () => {
  it('is a real button and a labelled file input inside a named group', async () => {
    renderUploader()
    const group = screen.getByRole('group', { name: 'Brand logo' })
    expect(within(group).getByRole('button', { name: 'Choose a logo' })).toBeTruthy()
    const input = fileInput(/Brand logo: choose a file/)
    expect(input.type).toBe('file')
    expect(input.accept).toBe('image/jpeg,image/png,image/webp')
  })

  it('opens the file chooser from the button, by keyboard too', async () => {
    renderUploader()
    const click = vi.spyOn(fileInput(), 'click')
    const user = setup()
    await user.tab()
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Choose a logo' }))
    await user.keyboard('{Enter}')
    expect(click).toHaveBeenCalled()
  })

  it('exposes progress as a named progress bar and announces it in a live region', async () => {
    const send = deferred()
    const { deps } = fakeDeps({ send: async (_s, _f, { onProgress }) => { onProgress(0.6); await send.promise } })
    render(<ImageUploader kind="brand_logo" label="Brand logo" onUploaded={() => {}} deps={deps} />)
    await setup().upload(fileInput(), image('logo.png'))
    const bar = await screen.findByRole('progressbar', { name: 'Uploading logo.png' })
    await waitFor(() => expect(bar.getAttribute('aria-valuenow')).toBe('60'))
    const live = screen.getAllByRole('status').find((el) => el.getAttribute('aria-live') === 'polite')!
    await waitFor(() => expect(live.textContent).toMatch(/logo\.png: 50% uploaded/))
    send.resolve()
    await waitFor(() => expect(live.textContent).toMatch(/logo\.png uploaded/))
  })

  it('names every button by the file it acts on', async () => {
    const send = deferred()
    const { deps } = fakeDeps({ send: async () => { await send.promise } })
    render(<ImageUploader kind="product_image" label="Product images" multiple onUploaded={() => {}} deps={deps} />)
    await setup().upload(fileInput(), [image('front.jpg', 'image/jpeg'), image('back.jpg', 'image/jpeg')])
    expect(await screen.findByRole('button', { name: 'Cancel upload of front.jpg' })).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Cancel upload of back.jpg' })).toBeTruthy()
    send.resolve()
  })
})

describe('cleaning up', () => {
  it('stops uploads and frees the previews when the screen is left', async () => {
    const revoke = vi.spyOn(URL, 'revokeObjectURL')
    const aborted = deferred<boolean>()
    const { deps } = fakeDeps({
      send: async (_s, _f, { signal }) => {
        signal.addEventListener('abort', () => aborted.resolve(true))
        await new Promise(() => {})
      },
    })
    const view = render(<ImageUploader kind="brand_logo" label="Brand logo" onUploaded={() => {}} deps={deps} />)
    await setup().upload(fileInput(), image('logo.png'))
    await screen.findByRole('progressbar', { name: 'Uploading logo.png' })
    view.unmount()
    expect(await aborted.promise).toBe(true)
    expect(revoke).toHaveBeenCalled()
  })

  it('frees the preview of a file that is removed', async () => {
    const revoke = vi.spyOn(URL, 'revokeObjectURL')
    const { user } = renderUploader()
    await user.upload(fileInput(), image('logo.png'))
    await screen.findByText('Uploaded')
    await user.click(screen.getByRole('button', { name: 'Remove logo.png from the list' }))
    expect(revoke).toHaveBeenCalled()
    expect(screen.queryByText('logo.png')).toBeNull()
  })
})

