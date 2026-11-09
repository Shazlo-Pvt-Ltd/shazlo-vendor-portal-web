import type { components } from '../api/schema'

type S = components['schemas']
export type ReasonCode = S['RejectBody']['reason_code']
export type Angle = S['ProductVersion']['images'][number]['angle']
type Event = S['History'][number]['event']

const lowerFirst = (text: string) => text.charAt(0).toLowerCase() + text.slice(1)

// A–05 product review, A–06 send back and A–07 brand page review.
export const reviewCopy = {
  nav: {
    back: 'Review queue',
    prev: 'Previous item in the queue',
    next: 'Next item in the queue',
    noPrev: 'This is the first item in the queue',
    noNext: 'This is the last item in the queue',
  },
  submitted: (stamp: string, wait: string) => `submitted ${lowerFirst(stamp)} · waiting ${wait}`,
  loading: 'Loading the submission',
  loadError: 'We could not load this submission.',
  retry: 'Try again',
  backToQueue: 'Back to the queue',
  nextItem: 'Next item',

  checklist: {
    title: 'Review checklist',
    approve: 'Approve and publish',
    approving: 'Approving…',
    sendBack: 'Send back',
    tickAll: 'Tick every check to approve',
  },

  history: {
    title: 'History',
    empty: 'Nothing has happened yet.',
    event: {
      submitted: 'Submitted by',
      approved: 'Approved by',
      rejected: 'Sent back by',
      published: 'Published by',
      applied: 'Applied by',
      info_requested: 'More information asked by',
      suspended: 'Suspended by',
      reactivated: 'Reactivated by',
      invited: 'Invited by',
    } satisfies Record<Event, string>,
  },

  decided: {
    approved: 'Approved. Publishing to the app.',
    sentBack: (seller: string, where: 'product' | 'brand page') => `Sent back. ${seller} will see your message on the ${where}.`,
    alreadyApproved: (by: string, when: string) => `Already approved by ${by} · ${when}.`,
    alreadySentBack: (by: string, when: string) => `Already sent back by ${by} · ${when}.`,
    alreadyBody: 'Nothing more to decide here.',
    conflict: 'Someone else decided this while you were reviewing.',
  },

  sendBack: {
    title: (subject: string) => `Send back ${subject}`,
    intro: 'Say what to fix. The item goes back to the seller, who can change it and resubmit.',
    reason: 'Reason',
    message: 'Message to the seller',
    hint: 'The seller sees this word for word.',
    count: (n: number) => `${n} / 600`,
    cancel: 'Cancel',
    submit: 'Send back to seller',
    submitting: 'Sending back…',
    errors: {
      reason: 'Choose a reason.',
      tooShort: 'Write at least 10 characters so the seller knows what to fix.',
      tooLong: 'Keep the message to 600 characters.',
    },
  },

  // reason_code → label and the message it starts the seller's note with.
  reasons: {
    photos: { label: 'Photos', message: 'Photos are missing or unclear. Add front, back and a fabric close-up on a plain background.' },
    price: { label: 'Price or MRP', message: 'The selling price or MRP does not match the tag. Check both and resubmit.' },
    category: { label: 'Category or fabric', message: 'The category or fabric looks wrong. Check them against the product.' },
    prohibited: { label: 'Prohibited item', message: 'This item is not allowed on Shazlo.' },
    description: { label: 'Description', message: 'The description needs more detail: fabric, fit, size and care.' },
    brand_images: { label: 'Images', message: 'Use your own photos for the cover and logo, with no text on them.' },
    contact_details: { label: 'Contact details in the text', message: 'Remove the phone number from your story; shoppers contact you through Shazlo.' },
    other: { label: 'Something else', message: '' },
  } satisfies Record<ReasonCode, { label: string; message: string }>,
  productReasons: ['photos', 'price', 'category', 'prohibited', 'description', 'other'] as ReasonCode[],
  brandReasons: ['brand_images', 'contact_details', 'other'] as ReasonCode[],

  product: {
    notFound: 'We could not find this product',
    notFoundTitle: 'Product not found',
    notFoundBody: 'It may have been removed by the seller. The queue shows what is still waiting.',
    pending: 'Pending review',
    resubmission: (n: number) => `Resubmission #${n}`,
    editToLive: 'Edit to live product',
    newProduct: 'New product',
    subtitle: (vendor: string, sku: string, submitted: string) => `${vendor} · ${sku} · ${submitted}`,
    toast: {
      approved: (title: string) => `Approved ${title}. Publishing to the app.`,
      sentBack: (title: string, seller: string) => `Sent back ${title}. ${seller} will see your message.`,
    },
    checks: [
      'Front, back and close-up photos',
      'Price matches the MRP on the tag',
      'Category and fabric are right',
      'Not on the prohibited list',
      'Description is accurate',
    ],
    photos: {
      title: 'Photos',
      angle: { front: 'front', back: 'back', closeup: 'close-up', extra: 'extra' } satisfies Record<Angle, string>,
      angleTitle: { front: 'Front', back: 'Back', closeup: 'Close-up', extra: 'Extra' } satisfies Record<Angle, string>,
      show: (angle: string) => `Show ${angle} photo`,
      alt: (angle: string, title: string) => `${angle.charAt(0).toUpperCase()}${angle.slice(1)} photo of ${title}`,
      newTag: 'New',
      newDescription: 'New in this submission',
      missing: (angle: string) => `${angle.charAt(0).toUpperCase()}${angle.slice(1)} photo missing`,
      missingNote: (angles: string[]) => `Missing ${angles.join(', ')} ${angles.length === 1 ? 'photo' : 'photos'}. Every product needs a front, back and close-up.`,
      none: 'No photos in this submission.',
    },
    compare: {
      sentBack: 'Compared with the version you sent back',
      live: 'Compared with the live version',
      field: 'Field',
      sentBackColumn: 'Sent-back version',
      liveColumn: 'Live version',
      thisColumn: 'This submission',
      changed: 'Changed',
      same: 'Same',
      rows: {
        photos: 'Photos',
        title: 'Title',
        price: 'Selling price / MRP',
        type: 'Type · gender · fabric',
        sizes: 'Sizes and stock',
        description: 'Description',
      },
      showFull: 'Show full description',
      showLess: 'Show less',
      noPhotos: 'No photos',
    },
    description: 'Description',
    sizes: {
      title: 'Sizes and stock',
      size: 'Size',
      sku: 'SKU',
      stock: 'Stock',
      total: 'Total',
    },
  },

  brand: {
    heading: (vendor: string) => `${vendor} · brand page`,
    title: (vendor: string) => `${vendor} brand page`,
    notFound: 'We could not find this brand page',
    notFoundTitle: 'Brand page not found',
    notFoundBody: 'The seller may have withdrawn it. The queue shows what is still waiting.',
    editToLive: 'Edit to live page',
    firstPage: 'First brand page',
    subject: 'brand page',
    toast: {
      approved: (vendor: string) => `Approved the ${vendor} brand page. Publishing to the app.`,
      sentBack: (vendor: string, seller: string) => `Sent back the ${vendor} brand page. ${seller} will see your message.`,
    },
    checks: ['Images belong to the brand', 'No phone numbers or outside links in the text', 'No text baked into the cover image', 'Story is accurate and respectful'],
    preview: {
      title: 'As shoppers will see it',
      live: 'Live now',
      draft: 'Submitted draft',
      notLive: 'Not live yet. This is the brand’s first page.',
      cover: 'Cover image',
    },
    changes: {
      title: 'Changes from the live page',
      none: 'Nothing differs from the live page.',
      before: 'Before',
      after: 'After',
      empty: 'None',
      noImage: 'No image',
      oldValue: 'Was',
      newValue: 'Now',
    },
    fields: {
      tagline: 'Tagline',
      story: 'Story',
      based_in: 'Based in',
      cover_url: 'Cover image',
      logo_url: 'Logo',
      return_policy: 'Return policy',
      dispatch_time: 'Dispatch time',
      instagram: 'Instagram',
      website: 'Website',
    } satisfies Record<keyof S['BrandProfile'], string>,
    returnPolicies: { no_returns: 'No returns', '7_day': '7-day returns', '14_day': '14-day returns' } as Record<string, string>,
    dispatchTimes: { '1_2_days': 'Ships in 1–2 days', '2_3_days': 'Ships in 2–3 days', '3_5_days': 'Ships in 3–5 days', '5_7_days': 'Ships in 5–7 days' } as Record<string, string>,
  },
} as const
