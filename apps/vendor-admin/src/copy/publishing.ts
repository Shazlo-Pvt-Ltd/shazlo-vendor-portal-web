// A-10 Publishing to the app. All of the screen's words, so Hindi can be added later.
const plural = (n: number, one: string, many: string) => `${n.toLocaleString('en-IN')} ${n === 1 ? one : many}`

export const publishingCopy = {
  title: 'Publishing to the app',
  subtitle: 'Approved changes reach the consumer app through the outbox. Failed events retry on their own; you can also retry them now.',
  retryAll: (failed: number) => (failed > 0 ? `Retry all failed (${failed.toLocaleString('en-IN')})` : 'Retry all failed'),
  retryAllRunning: 'Retrying…',
  nothingFailed: 'Nothing has failed',
  retryAllFailed: 'The retry did not go through',
  retriedAll: (n: number) => (n === 0 ? 'Nothing needed a retry.' : `Retried ${plural(n, 'event', 'events')}. ${n === 1 ? 'It' : 'They'} reached the app.`),
  updating: 'Updating events',

  figures: {
    label: 'Publishing figures',
    delivered: 'Delivered in the last 24 h',
    deliveredBaseline: 'Events the app accepted',
    waiting: 'Waiting',
    waitingBaseline: 'Sent within a minute',
    retrying: 'Retrying',
    retryingBaseline: 'Tried again on their own',
    failed: 'Failed',
    failedBaseline: 'Need a look or a retry',
  },

  tabsLabel: 'Event status',
  tabs: [
    { key: 'all', label: 'All' },
    { key: 'waiting', label: 'Waiting' },
    { key: 'retrying', label: 'Retrying' },
    { key: 'failed', label: 'Failed' },
    { key: 'delivered', label: 'Delivered' },
  ] as const,

  table: {
    label: 'Outbox events',
    event: 'Event',
    item: 'Item',
    vendor: 'Vendor',
    status: 'Status',
    tries: 'Tries',
    lastAttempt: 'Last attempt',
    nextAttempt: 'Next attempt',
  },

  details: {
    label: 'Event details',
    event: 'Event',
    vendor: 'Vendor',
    created: 'Created',
    tries: 'Tries',
    lastAttempt: 'Last attempt',
    nextAttempt: 'Next attempt',
    lastError: 'Last error',
    payload: 'Payload',
    retry: 'Retry now',
    retrying: 'Retrying…',
    retried: 'Delivered to the app',
    retryFailed: 'The retry did not go through',
    copy: 'Copy payload',
    copied: 'Payload copied',
    copyFailed: 'Could not copy. Select the payload and copy it yourself.',
    close: 'Close details',
  },

  when: {
    now: 'Now',
    inMinutes: (m: number) => `In ${m} min`,
    inHours: (h: number) => `In ${h} h`,
  },

  empty: {
    all: { title: 'Nothing has been published yet', body: 'Approved products, brand pages and vendor changes appear here on their way to the app.' },
    waiting: { title: 'Nothing waiting', body: 'Every approved change has been sent to the app.' },
    retrying: { title: 'Nothing retrying', body: 'No event is being tried again right now.' },
    failed: { title: 'No failed events', body: 'Every event reached the app or is still on its way.' },
    delivered: { title: 'Nothing delivered yet', body: 'Delivered events appear here once the app accepts them.' },
    showAll: 'Show all events',
  },
  error: {
    title: 'Events did not load',
    retry: 'Try again',
  },
} as const
