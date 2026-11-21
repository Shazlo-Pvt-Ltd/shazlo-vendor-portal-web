// Signed-out onboarding: V-02 Apply to sell, V-03 Set password, Forgot password. The sign-up's
// fields and messages are shared with Store details (./store.ts, ./catalog.ts).
// One module per screen group, so a Hindi version can be added beside it later.

const partnersEmail = 'partners@shazlo.store'

export const onboardingCopy = {
  partnersEmail,

  apply: {
    title: 'Apply to sell',
    intro: {
      subtitle: 'Tell us about your brand in 7 short steps. It takes about 8 minutes.',
      needTitle: 'What you will need',
      need: ['Your pickup address', 'Your bank account or UPI ID', 'Your GST number, if you have one'],
      saved: 'We save your answers on this device as you go, so you can stop and come back.',
      start: 'Start',
    },
    stepOf: (step: number, total: number) => `Step ${step} of ${total}`,
    // One page per topic, in order (spec §5).
    steps: [
      { title: 'Your brand', intro: 'The name shoppers will know you by, and where you ship from.' },
      { title: 'Contact', intro: 'We use these details only to talk to you about your store.' },
      { title: 'Delivery', intro: 'How your orders get to shoppers.' },
      { title: 'Returns', intro: 'Shoppers see this on every product before they buy.' },
      { title: 'Payment on delivery', intro: 'Shoppers can always pay online. Choose what they can also do when the order arrives.' },
      { title: 'Payouts', intro: 'Where we send the money from your sales.' },
      { title: 'Business details and commission', intro: 'The last step. Business details are optional.' },
    ],
    check: {
      title: 'Check your answers',
      subtitle: 'Change anything that is not right, then send your application.',
    },
    restored: {
      title: 'Picked up where you left off',
      body: 'Your answers were saved on this device.',
      startOver: 'Start over',
    },
    back: 'Back',
    next: 'Continue',
    submit: 'Send application',
    submitting: 'Sending…',
    signInPrompt: 'Already selling on Shazlo?',
    signIn: 'Sign in',
    failed: 'Your application did not send. Try again.',
    received: {
      title: 'Application received',
      subtitle: (name: string, brand: string) => `Thank you, ${name}. We have your application for ${brand}.`,
      nextTitle: 'What happens next',
      review: 'Our team reviews it within 2 working days.',
      commission: 'We agree your commission with you before you start selling.',
      approved: (email: string) => `If it is approved, we email ${email} a link to set your password.`,
      questions: 'Questions? Write to',
      backToSignIn: 'Back to sign in',
    },
  },

  setPassword: {
    title: 'Set your password',
    subtitle: (name: string, email: string, brand: string) => `Welcome, ${name}. Choose a password for ${email} to manage ${brand}.`,
    password: 'New password',
    confirm: 'Confirm password',
    showPassword: 'Show password',
    hidePassword: 'Hide password',
    rulesLabel: 'Password rules',
    rules: {
      length: 'At least 10 characters',
      personal: 'Not your email or brand name',
      mix: 'Includes a number or a symbol',
    },
    met: ', met',
    notMet: ', not met',
    summary: (met: number, total: number) => `${met} of ${total} rules met`,
    submit: 'Set password and sign in',
    submitting: 'Setting password…',
    errors: {
      passwordRequired: 'Choose a new password.',
      rules: 'Choose a password that meets all three rules.',
      confirmRequired: 'Type the same password again.',
      mismatch: 'The passwords do not match. Type the same password in both fields.',
    },
    expired: {
      title: 'This invite link has expired',
      bodyBefore: 'Invite links work once and expire after 7 days. Email',
      bodyAfter: 'and we will send a new one.',
      action: 'Go to sign in',
    },
    loadFailed: 'We could not check your invite link.',
    retry: 'Try again',
  },

  forgot: {
    title: 'Reset your password',
    subtitle: 'Enter the email you sign in with. We will send you a link to choose a new password.',
    email: 'Work email',
    submit: 'Send reset link',
    submitting: 'Sending…',
    backToSignIn: 'Back to sign in',
    sentTitle: 'Check your email',
    sentBody: (email: string) => `If an account exists for ${email}, we have sent a link to reset your password. It expires in 30 minutes.`,
    sentHelp: 'Nothing after a few minutes? Check your spam folder, or write to',
    failed: 'The reset link did not send. Try again.',
    errors: {
      emailRequired: 'Enter your work email.',
      emailFormat: 'Enter an email like name@brand.in.',
    },
  },
} as const
