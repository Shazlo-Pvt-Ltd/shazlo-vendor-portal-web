// Copy for the Store and Account pages (the phone tabs). One module per screen keeps a later Hindi
// translation in one place.
import { formatBps as rate } from '../lib/commission'

export const hubsCopy = {
  todo: 'To do',
  store: {
    title: 'Store',
    subtitle: 'What shoppers see, and how you sell on Shazlo.',
    listLabel: 'Store pages',
    brand: { title: 'Brand page', body: 'Logo, cover photo and your story.' },
    details: { title: 'Store details', body: 'Pickup, delivery, returns, payment and payouts.' },
    commission: {
      title: 'Commission',
      not_set: 'Not agreed yet',
      proposed: (bps: number) => `You proposed ${rate(bps)}. Waiting for Shazlo.`,
      sent_back: 'Sent back with a note from Shazlo',
      agreed: (bps: number) => `${rate(bps)} of each sale`,
    },
  },
  account: {
    title: 'Account',
    listLabel: 'Account pages',
    person: (name: string, role: string) => `${name} · ${role}`,
    owner: 'Owner',
    staff: 'Staff',
    team: { title: 'Team', body: 'People who manage this store with you.' },
    password: { title: 'Password', body: 'Change the password you sign in with.' },
    help: { title: 'Help & support', body: 'Answers about reviews, photos and payouts.' },
    signOut: 'Sign out',
  },
} as const
