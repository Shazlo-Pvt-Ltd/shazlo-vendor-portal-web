export const authCopy = {
  help: 'Need help?',
  helpShort: 'Email us',
  helpEmail: 'partners@shazlo.store',
  footer: [
    { label: 'Seller terms', href: 'https://shazlo.store/seller-terms' },
    { label: 'Privacy', href: 'https://shazlo.store/privacy' },
    { label: 'Commission & payouts', href: 'https://shazlo.store/seller-commission' },
  ],
  signIn: {
    title: 'Sign in to your seller account',
    subtitle: 'Manage your brand page, products and review status.',
    email: 'Work email',
    password: 'Password',
    showPassword: 'Show password',
    hidePassword: 'Hide password',
    remember: 'Keep me signed in on this device',
    forgot: 'Forgot password?',
    submit: 'Sign in',
    submitting: 'Signing in…',
    newHere: 'New to Shazlo?',
    apply: 'Apply to sell',
    errors: {
      emailRequired: 'Enter your work email.',
      emailFormat: 'Enter an email like name@brand.in.',
      passwordRequired: 'Enter your password.',
    },
  },
  why: {
    title: 'Why sell on Shazlo',
    tagline: 'swipe to style',
    points: [
      { title: 'Seen in the swipe feed', body: 'Approved products appear in the Shazlo app, where shoppers swipe through looks from independent labels.' },
      { title: 'Reviewed within 24 hours', body: 'Our team checks every product and tells you exactly what to fix if something is missing.' },
      { title: '15% commission, no listing fees', body: 'You see what you receive on every product before you send it for review.' },
    ],
  },
} as const
