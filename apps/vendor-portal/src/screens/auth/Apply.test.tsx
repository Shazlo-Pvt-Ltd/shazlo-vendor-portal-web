import { screen, waitFor, within } from '@testing-library/react'
import { http, HttpResponse } from 'msw'
import { describe, expect, it } from 'vitest'
import { renderApp } from '../../test/render'
import { server } from '../../test/server'

const DRAFT_KEY = 'shazlo.seller.application-draft'
const ABOUT = 'Hand block-printed in Ajrakhpur by a family of eight printers, using natural indigo and madder.'

type User = Awaited<ReturnType<typeof renderApp>>['user']

const steps = () => screen.getByRole('list', { name: 'Application steps' })
const currentStep = () => within(steps()).getAllByRole('listitem').find((li) => li.getAttribute('aria-current') === 'step')?.textContent
const next = (user: User) => user.click(screen.getByRole('button', { name: 'Continue' }))

async function fillBrand(user: User) {
  await user.type(await screen.findByLabelText('Brand name'), 'Kalki Studio')
  await user.type(screen.getByLabelText('City'), 'Ahmedabad, Gujarat')
  await user.type(screen.getByLabelText('Instagram or website (optional)'), '@kalki.studio')
}

async function fillContact(user: User) {
  await user.type(await screen.findByLabelText('Your name'), 'Kiran Shah')
  await user.type(screen.getByLabelText('Work email'), 'kiran@kalkistudio.in')
  await user.type(screen.getByLabelText('Mobile number'), '+91 98250 12345')
}

async function fillCatalogue(user: User) {
  await user.click(await screen.findByRole('button', { name: 'Kurtas', pressed: false }))
  await user.click(screen.getByRole('button', { name: 'Dupattas', pressed: false }))
  await user.type(screen.getByLabelText('Lowest price'), '1,200')
  await user.type(screen.getByLabelText('Highest price'), '4500')
  // Pasted: typing 90 characters one by one adds nothing the counter test does not cover.
  await user.click(screen.getByLabelText('Tell us about your label'))
  await user.paste(ABOUT)
}

async function reachCatalogue(user: User) {
  await fillBrand(user)
  await next(user)
  await fillContact(user)
  await next(user)
  await screen.findByRole('heading', { level: 2, name: 'What do you make?' })
}

describe('V-02 Apply to sell', () => {
  it('lays the application out as three steps, starting with the brand (options board pick)', async () => {
    await renderApp({ route: '/apply', signedIn: false })
    expect(await screen.findByRole('heading', { level: 1, name: 'Apply to sell' })).toBeInTheDocument()
    const items = within(steps()).getAllByRole('listitem')
    expect(items.map((li) => li.textContent)).toEqual(['1Your brand', '2Contact', '3Catalogue'])
    expect(currentStep()).toContain('Your brand')
    expect(screen.getByRole('heading', { level: 2, name: 'Tell us about your brand' })).toBeInTheDocument()
    expect(screen.getByText('Already selling on Shazlo?')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Sign in' })).toHaveAttribute('href', '/sign-in')
    expect(screen.queryByRole('button', { name: 'Back' })).toBeNull()
  })

  it('checks the brand step before moving on and focuses the first problem', async () => {
    const { user } = await renderApp({ route: '/apply', signedIn: false })
    await next(user)
    const brand = await screen.findByLabelText('Brand name')
    expect(brand).toHaveAttribute('aria-invalid', 'true')
    expect(brand).toHaveAccessibleDescription('Add your brand name.')
    expect(brand).toHaveFocus()
    expect(screen.getByLabelText('City')).toHaveAccessibleDescription('Add your city, like Ahmedabad, Gujarat.')
    // The link is optional, but a value must look like a handle or a website.
    expect(screen.getByLabelText('Instagram or website (optional)')).not.toHaveAttribute('aria-invalid', 'true')
    await user.type(screen.getByLabelText('Instagram or website (optional)'), 'my shop!')
    await next(user)
    expect(screen.getByLabelText('Instagram or website (optional)')).toHaveAccessibleDescription('Enter an Instagram handle like @kalki.studio or a website like kalkistudio.in.')
    expect(currentStep()).toContain('Your brand')

    await user.clear(screen.getByLabelText('Instagram or website (optional)'))
    await user.type(screen.getByLabelText('Brand name'), 'Kalki Studio')
    await user.type(screen.getByLabelText('City'), 'Ahmedabad, Gujarat')
    await next(user)
    const heading = await screen.findByRole('heading', { level: 2, name: 'Who should we talk to?' })
    expect(heading).toHaveFocus()
    expect(currentStep()).toContain('Contact')
    expect(within(steps()).getAllByRole('listitem')[0]).toHaveTextContent('Your brand, done')
  })

  it('checks the contact step, accepts +91 and spaces, and keeps answers when going back', async () => {
    const { user } = await renderApp({ route: '/apply', signedIn: false })
    await fillBrand(user)
    await next(user)
    await next(user)
    const name = await screen.findByLabelText('Your name')
    expect(name).toHaveAccessibleDescription('Add your name.')
    expect(name).toHaveFocus()
    expect(screen.getByLabelText('Work email')).toHaveAccessibleDescription('Enter your work email.')
    expect(screen.getByLabelText('Mobile number')).toHaveAccessibleDescription('Enter your mobile number.')

    await user.type(name, 'Kiran Shah')
    await user.type(screen.getByLabelText('Work email'), 'kiran@')
    await user.type(screen.getByLabelText('Mobile number'), '12345')
    await next(user)
    expect(screen.getByLabelText('Work email')).toHaveAccessibleDescription('Enter an email like name@brand.in.')
    expect(screen.getByLabelText('Mobile number')).toHaveAccessibleDescription('Enter a 10-digit Indian mobile number, like 98250 12345.')
    expect(screen.getByLabelText('Work email')).toHaveFocus()

    await user.click(screen.getByRole('button', { name: 'Back' }))
    expect(await screen.findByLabelText('Brand name')).toHaveValue('Kalki Studio')
    await next(user)
    expect(await screen.findByLabelText('Your name')).toHaveValue('Kiran Shah')
    expect(screen.getByLabelText('Work email')).toHaveValue('kiran@')

    await user.type(screen.getByLabelText('Work email'), 'kalkistudio.in')
    await user.clear(screen.getByLabelText('Mobile number'))
    await user.type(screen.getByLabelText('Mobile number'), '+91 98250 12345')
    await next(user)
    expect(await screen.findByRole('heading', { level: 2, name: 'What do you make?' })).toHaveFocus()
  })

  it('checks the catalogue step: at least one category, a price range in order, 40 to 600 characters', async () => {
    const { user } = await renderApp({ route: '/apply', signedIn: false })
    await reachCatalogue(user)
    const categories = screen.getByRole('group', { name: 'What you sell' })
    expect(within(categories).getAllByRole('button').map((b) => b.textContent)).toEqual(['Kurtas', 'Kurtis', 'Sarees', 'Dupattas', 'Stoles', 'Jackets', 'Shirts', 'Skirts', 'Co-ords', 'Dresses', 'Palazzos'])

    await user.click(screen.getByRole('button', { name: 'Send application' }))
    expect(categories).toHaveAccessibleDescription('Choose at least one thing you sell.')
    expect(within(categories).getByRole('button', { name: 'Kurtas' })).toHaveFocus()
    expect(screen.getByLabelText('Lowest price')).toHaveAccessibleDescription('Enter your lowest price in rupees.')
    expect(screen.getByLabelText('Highest price')).toHaveAccessibleDescription('Enter your highest price in rupees.')
    expect(screen.getByLabelText('Tell us about your label')).toHaveAccessibleDescription('Tell us a little more: at least 40 characters.')

    await user.click(within(categories).getByRole('button', { name: 'Sarees', pressed: false }))
    expect(within(categories).getByRole('button', { name: 'Sarees' })).toHaveAttribute('aria-pressed', 'true')
    await user.type(screen.getByLabelText('Lowest price'), '4500')
    await user.type(screen.getByLabelText('Highest price'), '1200')
    await user.type(screen.getByLabelText('Tell us about your label'), 'Handmade.')
    expect(screen.getByText('9 / 600')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Send application' }))
    expect(categories).not.toHaveAccessibleDescription('Choose at least one thing you sell.')
    expect(screen.getByLabelText('Highest price')).toHaveAccessibleDescription('The highest price should be at least the lowest.')
    expect(screen.getByLabelText('Highest price')).toHaveFocus()
    expect(screen.getByLabelText('Tell us about your label')).toHaveAccessibleDescription('Tell us a little more: at least 40 characters.')
    expect(screen.queryByRole('heading', { name: 'Application received' })).toBeNull()
  })

  it('saves each step on this device and picks up where the seller left off', async () => {
    const first = await renderApp({ route: '/apply', signedIn: false })
    await fillBrand(first.user)
    await next(first.user)
    await first.user.type(await screen.findByLabelText('Your name'), 'Kiran Shah')
    const saved = JSON.parse(localStorage.getItem(DRAFT_KEY) ?? 'null')
    expect(saved).toMatchObject({ step: 1, brand: { brand_name: 'Kalki Studio', city: 'Ahmedabad, Gujarat' }, contact: { owner_name: 'Kiran Shah' } })
    first.unmount()

    const { user } = await renderApp({ route: '/apply', signedIn: false })
    expect(await screen.findByText('Picked up where you left off')).toBeInTheDocument()
    expect(currentStep()).toContain('Contact')
    expect(screen.getByLabelText('Your name')).toHaveValue('Kiran Shah')
    await user.click(screen.getByRole('button', { name: 'Back' }))
    expect(await screen.findByLabelText('Brand name')).toHaveValue('Kalki Studio')
    expect(screen.getByLabelText('Instagram or website (optional)')).toHaveValue('@kalki.studio')

    await user.click(screen.getByRole('button', { name: 'Start over' }))
    expect(screen.queryByText('Picked up where you left off')).toBeNull()
    expect(await screen.findByLabelText('Brand name')).toHaveValue('')
    expect(currentStep()).toContain('Your brand')
    expect(localStorage.getItem(DRAFT_KEY)).toBeNull()
  })

  it('ignores a draft it cannot read', async () => {
    localStorage.setItem(DRAFT_KEY, '{"step": 2, "brand": ')
    await renderApp({ route: '/apply', signedIn: false })
    expect(await screen.findByLabelText('Brand name')).toHaveValue('')
    expect(screen.queryByText('Picked up where you left off')).toBeNull()
    expect(currentStep()).toContain('Your brand')
  })

  it('maps field errors from the server back to their step, starting with the earliest', async () => {
    server.use(
      http.post(
        '*/api/v1/public/vendor-applications',
        () =>
          HttpResponse.json(
            { message: 'Check the highlighted fields.', extra: { code: 'validation_error', fields: { phone: 'This number is already on another application.', brand_name: 'A label with this name has already applied.' } } },
            { status: 422 },
          ),
        { once: true },
      ),
    )
    const { user, db } = await renderApp({ route: '/apply', signedIn: false })
    await reachCatalogue(user)
    await fillCatalogue(user)
    await user.click(screen.getByRole('button', { name: 'Send application' }))

    expect(await screen.findByRole('alert')).toHaveTextContent('Check the highlighted fields.')
    const brand = await screen.findByLabelText('Brand name')
    expect(currentStep()).toContain('Your brand')
    expect(brand).toHaveAccessibleDescription('A label with this name has already applied.')
    await waitFor(() => expect(brand).toHaveFocus())

    await user.clear(brand)
    await user.type(brand, 'Kalki Studio Ahmedabad')
    await next(user)
    expect(await screen.findByLabelText('Mobile number')).toHaveAccessibleDescription('This number is already on another application.')
    await user.clear(screen.getByLabelText('Mobile number'))
    await user.type(screen.getByLabelText('Mobile number'), '99090 54321')
    await next(user)
    // Catalogue answers survived the round trip.
    expect(await screen.findByRole('button', { name: 'Kurtas' })).toHaveAttribute('aria-pressed', 'true')
    expect(screen.getByLabelText('Tell us about your label')).toHaveValue(ABOUT)
    await user.click(screen.getByRole('button', { name: 'Send application' }))
    expect(await screen.findByRole('heading', { level: 1, name: 'Application received' })).toBeInTheDocument()
    expect(db.applications[0]).toMatchObject({ brand_name: 'Kalki Studio Ahmedabad', phone: '+919909054321' })
  })

  it('sends the application in paise, clears the draft and says what happens next', async () => {
    const { user, db } = await renderApp({ route: '/apply', signedIn: false })
    await reachCatalogue(user)
    await fillCatalogue(user)
    expect(localStorage.getItem(DRAFT_KEY)).not.toBeNull()
    await user.click(screen.getByRole('button', { name: 'Send application' }))

    const title = await screen.findByRole('heading', { level: 1, name: 'Application received' })
    expect(document.activeElement).toContainElement(title)
    expect(db.applications).toHaveLength(1)
    expect(db.applications[0]).toMatchObject({
      brand_name: 'Kalki Studio',
      city: 'Ahmedabad, Gujarat',
      instagram_or_website: '@kalki.studio',
      owner_name: 'Kiran Shah',
      email: 'kiran@kalkistudio.in',
      phone: '+919825012345',
      product_types: ['Kurtas', 'Dupattas'],
      price_min_paise: 120000,
      price_max_paise: 450000,
      about: ABOUT,
    })
    expect(localStorage.getItem(DRAFT_KEY)).toBeNull()
    expect(screen.getByText('Thank you, Kiran. We have your application for Kalki Studio.')).toBeInTheDocument()
    expect(screen.getByText('Our team reviews it within 2 working days.')).toBeInTheDocument()
    expect(screen.getByText('If it is approved, we email kiran@kalkistudio.in a link to set your password.')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'partners@shazlo.store' })).toHaveAttribute('href', 'mailto:partners@shazlo.store')
    expect(screen.getByRole('link', { name: 'Back to sign in' })).toHaveAttribute('href', '/sign-in')
    expect(screen.queryByRole('list', { name: 'Application steps' })).toBeNull()
  })

  it('keeps the form and the answers when the network fails', async () => {
    server.use(http.post('*/api/v1/public/vendor-applications', () => HttpResponse.error(), { once: true }))
    const { user } = await renderApp({ route: '/apply', signedIn: false })
    await reachCatalogue(user)
    await fillCatalogue(user)
    await user.click(screen.getByRole('button', { name: 'Send application' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('You seem to be offline. Check your connection and try again.')
    expect(currentStep()).toContain('Catalogue')
    expect(screen.getByLabelText('Tell us about your label')).toHaveValue(ABOUT)
    expect(localStorage.getItem(DRAFT_KEY)).not.toBeNull()
  })

  it('fits a 390 px phone: labels sit under the step dots and nothing is wider than the screen', async () => {
    const { user, container } = await renderApp({ route: '/apply', signedIn: false, viewport: 'mobile' })
    await screen.findByRole('heading', { level: 1, name: 'Apply to sell' })
    expect(steps()).toHaveClass('MuiStepper-alternativeLabel')
    for (const label of ['Your brand', 'Contact', 'Catalogue']) expect(within(steps()).getByText(label)).toBeVisible()
    for (const el of container.querySelectorAll('*')) {
      const style = getComputedStyle(el)
      for (const value of [style.width, style.minWidth]) {
        if (value.endsWith('px')) expect(parseFloat(value), `${el.className} is ${value} wide`).toBeLessThanOrEqual(358)
      }
    }
    expect(getComputedStyle(screen.getByRole('button', { name: 'Continue' })).minHeight).toBe('44px')
    await fillBrand(user)
    await next(user)
    expect(await screen.findByRole('heading', { level: 2, name: 'Who should we talk to?' })).toBeInTheDocument()
    expect(getComputedStyle(screen.getByRole('button', { name: 'Back' })).minHeight).toBe('44px')
  })
})
