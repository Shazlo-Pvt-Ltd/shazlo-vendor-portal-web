// Copy for the app frame: the pages around the screens (errors, the session check, access). One
// module per area keeps a later Hindi translation in one place.
export const frameCopy = {
  goHome: 'Go to Home',
  loading: 'Loading',
  notFound: {
    title: 'We could not find that page',
    body: 'The link may be old, or the page moved. Everything you manage is a tap or two from Home.',
    pageTitle: 'Page not found',
  },
  error: {
    title: 'This page did not load',
    body: 'Something went wrong on our side. Nothing you saved was lost.',
    tryAgain: 'Try again',
    reload: 'Reload page',
  },
  misconfigured: {
    title: 'Shazlo Seller is not set up correctly',
    body: 'It cannot reach its server. If you build this app, fix the setting below and build it again. If you sell on Shazlo, please email us.',
  },
  unavailable: {
    title: "Can't reach the server",
    body: 'Check your connection and try again. You are still signed in.',
    retry: 'Try again',
  },
  forbidden: {
    title: "You don't have access to this page",
    body: 'Only the owner of your store can open it. If you need something done here, ask them.',
  },
  blocked: {
    pageTitle: 'Account unavailable',
    title: "This account can't use Shazlo Seller",
    body: 'Your store was not approved, or it has been paused, so you cannot sign in right now. Nothing you created has been deleted.',
    ask: 'To find out why, or to ask us to look again, email us.',
    email: 'Email support',
    otherAccount: 'Sign in with another account',
  },
  signedInLink: {
    title: 'You are signed in',
    body: (email: string) => `You are signed in as ${email}. This link may be for another account, so sign out before you use it.`,
    signOut: 'Sign out and continue',
    stay: 'Stay signed in',
    signingOut: 'Signing out…',
  },
  sessionEnded: 'Your session ended. Sign in again to carry on where you were.',
  pending: {
    title: 'Your application is in review',
    body: 'You can set up your brand page and add products now. Shoppers see nothing until we approve your store.',
  },
} as const
