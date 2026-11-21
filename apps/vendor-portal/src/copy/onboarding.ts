// Signed-out onboarding: V-02 Apply to sell, Verify your email, Set password (reset and invite),
// Forgot password. The sign-up's fields and messages are shared with Store details (./store.ts,
// ./catalog.ts); the email and password rules are in ./auth.ts.
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
      saved: 'We keep your answers while this tab is open, so you can go back and change them. Closing or reloading the page clears them.',
      start: 'Start',
    },
    stepOf: (step: number, total: number) => `Step ${step} of ${total}`,
    // One page per topic, in order (spec §5).
    steps: [
      { title: 'Your brand', intro: 'The name shoppers will know you by, and where you ship from.' },
      { title: 'Contact', intro: 'We use these details only to talk to you about your store. You sign in with this email and a password.' },
      { title: 'Delivery', intro: 'How your orders get to shoppers.' },
      { title: 'Returns', intro: 'Shoppers see this on every product before they buy.' },
      { title: 'Payment on delivery', intro: 'Shoppers can always pay online. Choose what they can also do when the order arrives.' },
      { title: 'Payouts', intro: 'Where we send the money from your sales.' },
      { title: 'Business details and commission', intro: 'The last step. Business details are optional.' },
    ],
    // The Contact step's password (main's rules: src/lib/account.ts).
    password: 'Choose a password',
    passwordHint: (min: number) => `At least ${min} characters. You sign in with your email and this password.`,
    passwordRow: 'Password',
    passwordChosen: 'Chosen',
    accountNotKept: 'We do not keep the account number if you leave this page. Type it again if you come back.',
    check: {
      title: 'Check your answers',
      subtitle: 'Change anything that is not right, then send your application.',
    },
    restored: {
      title: 'Picked up where you left off',
      body: 'We kept your answers while this tab was open. We never keep your password or bank account number, so type them again.',
      startOver: 'Start over',
    },
    back: 'Back',
    next: 'Continue',
    submit: 'Send application',
    submitting: 'Sending…',
    signInPrompt: 'Already selling on Shazlo?',
    signIn: 'Sign in',
    failed: 'Your application did not send. Try again.',
    // A 409: the API said the email already has an account.
    taken: {
      title: (email: string) => `There is already a seller account for ${email}.`,
      body: 'Sign in with it, or change the email under Contact to apply for another store.',
      signIn: 'Sign in',
    },
    received: {
      title: 'Application received',
      subtitle: (name: string, brand: string) => (name ? `Thank you, ${name}. We have your application for ${brand}.` : `Thank you. We have your application for ${brand}.`),
      verifyTitle: 'Confirm your email',
      verify: (email: string) => `We sent an email to ${email}. Open the link in it to confirm your email, then sign in with your password.`,
      verifyHelp: 'It can take a few minutes. Check your spam folder too.',
      nextTitle: 'What happens next',
      review: 'Our team reviews your application within 2 working days. Once your email is confirmed, you can sign in and get your brand page and products ready meanwhile.',
      commission: 'We agree your commission with you before you start selling.',
      questions: 'Questions? Write to',
      backToSignIn: 'Back to sign in',
    },
  },

  // Asking for another confirmation email (after sign-up, or from an old link).
  resend: {
    prompt: 'Did not get it?',
    formTitle: 'Get a new link',
    email: 'Your email',
    submit: 'Send the email again',
    submitAgain: (seconds: number) => `Send again in ${seconds} s`,
    sending: 'Sending…',
    // The same words whatever the address: nobody learns whether it has an account.
    sent: 'If that email needs a new link, it is on its way. Check your inbox and spam folder.',
    sentTo: (email: string) => `We sent it again to ${email}. Check your inbox and spam folder.`,
  },

  verify: {
    checking: 'Checking your link…',
    confirmedTitle: 'Your email is confirmed',
    confirmedBody: 'Thank you. You can sign in now with your email and password.',
    signIn: 'Sign in',
    invalidTitle: 'This link has expired or was already used',
    invalidBody: 'Links to confirm an email work once, for a limited time. If you already confirmed yours,',
    invalidSignIn: 'sign in',
    invalidAfter: '. Otherwise, ask for a new link below.',
    problemTitle: 'We could not check your link',
    tryAgain: 'Try again',
  },

  setPassword: {
    title: 'Set your password',
    subtitle: 'Choose a password for your seller account.',
    // An invite link: vendor-api does not say who it is for, so the greeting names nobody.
    inviteSubtitle: 'Welcome to Shazlo Seller. Choose a password to finish setting up your account.',
    password: 'New password',
    passwordHint: (min: number) => `At least ${min} characters. A few words that do not belong together work well.`,
    confirm: 'New password again',
    submit: 'Save password',
    submitting: 'Saving…',
    saved: 'Your password is set. Sign in with it.',
    expired: {
      title: 'This link has expired or was already used',
      reset: 'Links to choose a password work once, for a limited time. Ask for a new one, or sign in if you already chose a password.',
      invite: 'Invite links work once, for a limited time. Ask the owner of your store to send you a new invite, or sign in if you already chose a password.',
      newLink: 'Send me a new link',
      signIn: 'Go to sign in',
    },
    backToSignIn: 'Back to sign in',
  },

  forgot: {
    title: 'Reset your password',
    subtitle: 'Enter the email you sign in with. We will send you a link to choose a new password.',
    email: 'Work email',
    submit: 'Send reset link',
    submitting: 'Sending…',
    backToSignIn: 'Back to sign in',
    sentTitle: 'Check your email',
    // The same answer whether or not the address has an account.
    sentBody: (email: string) => `If an account uses ${email}, we have sent it a link to choose a new password. The link works once, for a limited time.`,
    sentHelp: 'Nothing after a few minutes? Check your spam folder, or write to',
    failed: 'The reset link did not send. Try again.',
  },
} as const
