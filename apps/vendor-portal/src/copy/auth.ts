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
    forgot: 'Forgot password?',
    wait: (seconds: number) => `Too many attempts. Try again in ${seconds} s.`,
    waitAnnounced: 'Too many attempts. Wait a minute, then try again.',
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
  // A call that failed (src/lib/failure.ts).
  failures: {
    tooMany: 'Too many attempts.',
    ourSide: 'Something went wrong on our side. Try again in a moment.',
    unknown: 'Something went wrong. Try again.',
    // The countdown after "Too many attempts": seen every second, announced once.
    wait: (seconds: number) => `Too many attempts. Try again in ${seconds} s.`,
    waitAnnounced: 'Too many attempts. Wait a minute, then try again.',
  },
  // The email and password rules (src/lib/account.ts).
  rules: {
    emailRequired: 'Enter your email.',
    emailFormat: 'Enter an email like name@brand.in.',
    passwordRequired: 'Choose a password.',
    passwordShort: (min: number) => `Use at least ${min} characters.`,
    passwordLong: (max: number) => `Use at most ${max} characters.`,
    passwordIsEmail: 'Your password cannot be your email address.',
    confirmRequired: 'Type the same password again.',
    mismatch: 'The passwords do not match. Type the same password in both fields.',
    currentRequired: 'Enter your current password.',
    newRequired: 'Choose a new password.',
    sameAsCurrent: 'Choose a password different from your current one.',
    newMismatch: 'The new passwords do not match. Type the same password in both fields.',
  },
  why: {
    title: 'Why sell on Shazlo',
    tagline: 'swipe to style',
    points: [
      { title: 'Seen in the swipe feed', body: 'Approved products appear in the Shazlo app, where shoppers swipe through looks from independent labels.' },
      { title: 'Reviewed within 24 hours', body: 'Our team checks every product and tells you exactly what to fix if something is missing.' },
      { title: 'Your own commission rate, no listing fees', body: 'You see what you receive on every product before you send it for review.' },
    ],
  },
} as const
