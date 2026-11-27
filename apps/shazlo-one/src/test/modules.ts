import type { ModuleSummary } from '@shazlo/shell-protocol'
import { fakeModule } from '@shazlo/shell-protocol/testing'
import { registry } from '../app/registry'
import { ADMIN_ID } from '../mocks/identity'

// Two stand-in modules (src/test/registry.json): the shell is tested against these, never a real one.
// Catalogue is open to reviewers and super admins and has a full summary; Campaigns is for super
// admins only and has a small one, so the tests can tell whose badge and cards are whose.

const entry = (id: string) => registry.find((m) => m.id === id)!

// Monday 9 Nov 2026, 14:00 IST is "now" in the Home tests; activity is relative to it.
const at = (hoursBefore: number) => new Date(Date.parse('2026-11-09T14:00:00+05:30') - hoursBefore * 3_600_000).toISOString()

export const catalogueSummary: ModuleSummary = {
  v: 1,
  badge: { count: 14, label: '14 waiting' },
  sections: [
    {
      title: 'Catalogue review',
      icon: 'shopping-bag',
      action: { label: 'Open review queue', path: '/queue' },
      figures: [
        { label: 'Waiting', value: 14, unit: 'count', hint: 'Listings 9 · Shop pages 2 · Sign-ups 3', path: '/queue' },
        { label: 'Waiting over 24 hours', value: 6, unit: 'count', hint: 'Oldest first in the queue', path: '/queue?sort=oldest' },
        { label: 'Decided today', value: 1, unit: 'count', hint: 'Approved or sent back since midnight' },
        { label: 'Median time to decision', value: 320, unit: 'minutes', hint: 'From submission to decision' },
      ],
    },
    {
      title: 'Publishing to the app',
      icon: 'send',
      action: { label: 'Open publishing', path: '/publishing' },
      alert: { tone: 'warning', text: '1 event did not reach the app. It retries automatically, or you can retry it now.', action: { label: 'Open publishing', path: '/publishing' } },
      figures: [
        { label: 'Delivered in the last 24 h', value: 324, unit: 'count', hint: 'Reached the Shazlo app', path: '/publishing?status=delivered' },
        { label: 'Waiting', value: 2, unit: 'count', hint: 'Sent within a minute', path: '/publishing?status=waiting' },
        { label: 'Retrying', value: 1, unit: 'count', hint: 'The app did not answer yet', path: '/publishing?status=retrying' },
        { label: 'Failed', value: 1, unit: 'count', hint: 'Needs a look', path: '/publishing?status=failed' },
      ],
    },
  ],
  activity: {
    title: 'Recent decisions',
    icon: 'clipboard-check',
    empty: { title: 'No decisions yet', body: 'Approvals and send-backs show here as reviewers make them.' },
    items: [
      { id: 'd1', title: 'Bandhani Silk Dupatta', subtitle: 'Kalki Studio · Listing', status: { tone: 'positive', label: 'Approved' }, at: at(3), actor_id: ADMIN_ID.priya, path: '/queue' },
      { id: 'd2', title: 'Ajrakh Block-Print Kurta', subtitle: 'Kalki Studio · Listing', status: { tone: 'attention', label: 'Sent back' }, at: at(10), actor_id: ADMIN_ID.priya, path: '/queue' },
      { id: 'd3', title: 'Kalki Studio shop page', subtitle: 'Kalki Studio · Shop page', status: { tone: 'positive', label: 'Approved' }, at: at(26), actor_id: ADMIN_ID.naman, path: '/review/shop/s_kalki' },
      { id: 'd4', title: 'Mor Pankh Clothing', subtitle: 'Mor Pankh Clothing · Sign-up', status: { tone: 'positive', label: 'Approved' }, at: at(80), actor_id: ADMIN_ID.rahul, path: '/sellers/s_morpankh' },
    ],
  },
}

export const campaignsSummary: ModuleSummary = {
  v: 1,
  badge: { count: 3, label: '3 to approve' },
  sections: [{ title: 'Campaigns', icon: 'megaphone', figures: [{ label: 'Drafts to approve', value: 3, unit: 'count', path: '/drafts' }] }],
}

export const catalogue = fakeModule(entry('catalogue'), {
  manifest: {
    title: 'Catalogue',
    icon: 'shopping-bag',
    home: { label: 'Review queue', path: '/queue', icon: 'inbox' },
    links: [
      { label: 'Review queue', path: '/queue', icon: 'inbox', also: ['/review'] },
      { label: 'All sellers', path: '/sellers', icon: 'building-2' },
      { label: 'Publishing', path: '/publishing', icon: 'send' },
    ],
  },
  summary: catalogueSummary,
})

export const campaigns = fakeModule(entry('campaigns'), {
  manifest: {
    title: 'Campaigns',
    icon: 'megaphone',
    home: { label: 'Drafts', path: '/drafts', icon: 'file-text' },
    links: [{ label: 'Drafts', path: '/drafts', icon: 'file-text' }],
  },
  summary: campaignsSummary,
})

export const fakeModules = [catalogue, campaigns]
