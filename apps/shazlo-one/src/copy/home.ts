// Home's own words. What a module's cards say comes from that module's summary (ADR 0011).
export const homeCopy = {
  greeting: (part: 'morning' | 'afternoon' | 'evening', name: string) => `Good ${part}, ${name}`,
  subtitle: 'Here is what is waiting across Shazlo One.',
  retry: 'Try again',
  module: {
    loading: (title: string) => `Loading ${title} figures`,
    error: (title: string) => `${title} figures did not load`,
    open: (title: string) => `Open ${title}`,
    noSummary: { body: 'This module has no figures to show here. Open it to see its work.' },
  },
  activity: {
    by: (name: string) => `by ${name}`,
    // Where an admin's name cannot be found: the admin was deleted, never recorded, or identity-api did not answer.
    formerAdmin: 'a former admin',
  },
  noModules: {
    title: 'No modules for your role yet',
    body: 'Your account has no module roles, so there is nothing to review here. Ask a super admin to add the role you need in Admins & roles.',
  },
} as const
