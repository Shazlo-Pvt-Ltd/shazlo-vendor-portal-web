// Copy for the product editor (V-07). One module per screen keeps a later Hindi translation in one place.

// Options match vendor-api's lists (src/mocks/db.ts until the real endpoints ship).
const categories = ['Kurtas', 'Kurtis', 'Sarees', 'Dupattas', 'Stoles', 'Jackets', 'Shirts', 'Skirts', 'Co-ords', 'Dresses', 'Palazzos']
const genders = ['Women', 'Men', 'Unisex']
const fabrics = ['Cotton (mul)', 'Cotton', 'Linen', 'Silk', 'Mashru silk', 'Kala cotton', 'Khadi', 'Chanderi']
const sizes = ['XS', 'S', 'M', 'L', 'XL', 'XXL', 'One size']

const returnPolicies: Record<string, string> = {
  no_returns: 'no returns',
  '7_day': '7-day returns',
  '14_day': '14-day returns',
}

export const productEditorCopy = {
  options: { categories, genders, fabrics, sizes },

  newTitle: 'New product',
  productTitle: 'Product',
  untitled: 'Untitled product',
  newSubtitle: 'Start with a title. Everything saves as you type.',
  loading: 'Loading product',
  moreActions: 'More actions',

  save: {
    createFailed: 'We could not start this draft. Check your connection, then edit the title to try again.',
  },

  submit: {
    draft: 'Submit for review',
    rejected: 'Resubmit for review',
    approved: 'Submit changes for review',
    sending: 'Sending for review…',
  },

  archive: {
    menu: 'Archive product',
    title: 'Archive this product?',
    body: 'It leaves the app and moves to Archived.',
    confirm: 'Archive product',
    cancel: 'Cancel',
    done: 'Product archived. Find it under Archived in Products.',
  },

  banners: {
    reviewedBy: (when: string) => `Shazlo review team · ${when}`,
    pending: 'This product is in review. You can edit it again once our team has decided.',
    editInReview: 'Your changes are in review. The live version stays in the app until we approve them.',
    archived: 'This product is archived, so shoppers cannot see it.',
    locked: 'This product is in review, so your last change was not saved. You can edit it again once our team has decided.',
    sent: 'Sent for review. We usually decide within 24 hours.',
    changesSent: 'Changes sent for review. The live version stays in the app until we approve them.',
    problems: 'Fix these before sending for review.',
    unsaved: 'Your latest changes did not save, so we have not sent this for review. Check your connection and try again.',
    retry: 'Try again',
  },

  photos: {
    title: 'Photos',
    limits: '3 required · up to 8',
    helper: 'JPG, PNG or WebP · max 10 MB · at least 1200 px on the long side. The front photo is the cover in the feed.',
    needsTitle: 'Add a title first to upload photos.',
    requiredList: 'Required photos',
    extraList: 'Extra photos',
    extraHeading: 'Extra photos',
    extraHint: 'Optional: details, styling, the fabric in daylight.',
    slots: { front: 'Front', back: 'Back', closeup: 'Fabric close-up' },
    upload: (label: string) => `Upload ${label.toLowerCase()}`,
    fileInput: (label: string) => `${label} photo file`,
    photoAlt: (label: string) => `${label} photo`,
    remove: (label: string) => `Remove ${label.toLowerCase()} photo`,
    replace: 'Replace',
    replaceLabel: (label: string) => `Replace ${label.toLowerCase()} photo`,
    missing: (label: string) => `${label} photo is missing.`,
    extra: (n: number) => `Extra ${n}`,
    extraAlt: (n: number) => `Extra photo ${n}`,
    removeExtra: (n: number) => `Remove extra photo ${n}`,
    replaceExtra: (n: number) => `Replace extra photo ${n}`,
    replaceExtraFile: (n: number) => `Replacement for extra photo ${n}`,
    addPhoto: 'Add photo',
    addFileInput: 'Extra photo file',
    uploading: 'Uploading…',
    removed: (label: string) => `${label} photo removed.`,
    notAdded: (file: string, reason: string) => `${file} was not added. ${reason}`,
    removeFailed: 'That photo was not removed. Try again.',
  },

  details: {
    title: 'Details',
    name: 'Title',
    nameHint: 'What it is, in a few words. For example: Ajrakh Block-Print Kurta.',
    description: 'Description',
    descriptionHint: 'Fabric, fit, how it is made and how to care for it.',
    category: 'Product type',
    gender: 'Gender',
    fabric: 'Fabric',
  },

  price: {
    title: 'Price',
    mrp: 'MRP (₹)',
    mrpHint: 'The price on the tag.',
    selling: 'Selling price (₹)',
    sellingHint: 'What shoppers pay. It can match the MRP.',
    receive: 'You receive per sale',
    after: (percent: string, commission: string) => `after ${percent} commission (${commission})`,
    afterUnknown: 'after Shazlo commission',
    noPrice: 'Add a selling price to see what you receive.',
    fixPrice: 'Fix the selling price to see what you receive.',
    errors: {
      format: 'Enter an amount in rupees, like 2,499.',
      sellingZero: 'Enter a selling price above ₹0.',
      mrpZero: 'Enter an MRP above ₹0.',
      aboveMrp: 'Selling price cannot be above the MRP.',
      liveNeedsPrice: 'This product is live, so it needs a selling price.',
      liveNeedsMrp: 'This product is live, so it needs an MRP.',
    },
  },

  sizes: {
    title: 'Sizes and stock',
    chips: 'Sizes',
    chipsHint: 'Pick every size you make, then set how many you have.',
    decrease: (size: string) => `Decrease stock for ${size}`,
    increase: (size: string) => `Increase stock for ${size}`,
    stock: (size: string) => `Stock for ${size}`,
    total: (stock: string, count: number) => `${stock} in stock across ${count} ${count === 1 ? 'size' : 'sizes'}`,
    none: 'No sizes yet. Pick the sizes you make.',
  },

  history: {
    title: 'Review history',
    events: {
      created: 'Created as draft',
      submitted: 'Submitted for review',
      rejected: 'Sent back',
      approved: 'Approved',
      archived: 'Archived',
    } as Record<string, string>,
  },

  liveNote: {
    title: 'What needs review again',
    immediate: 'Price and stock: live immediately',
    reviewed: 'Title, description, photos: reviewed first',
  },

  returns: {
    title: 'Returns',
    useDefault: (policy: string | undefined) => (policy ? `Use store default: ${returnPolicies[policy] ?? policy}` : 'Use the store default return policy'),
    hint: 'Override only if this product cannot be returned, for example made-to-measure.',
    overridden: 'Shoppers cannot return this product.',
  },

  notFound: {
    title: 'We could not find that product',
    body: 'It may have been archived, or the link is old. Your other products are in Products.',
    back: 'Back to products',
  },
  loadFailed: 'This product did not load.',

  fieldLabels: {
    images: 'Photos',
    title: 'Title',
    description: 'Description',
    category: 'Product type',
    gender: 'Gender',
    fabric: 'Fabric',
    price_paise: 'Selling price',
    mrp_paise: 'MRP',
    variants: 'Sizes and stock',
  } as Record<string, string>,
} as const
