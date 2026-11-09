import { formatCount } from '../lib/format'

// Copy for Bulk import (V-08). One module per screen keeps a later Hindi translation in one place.
const rows = (n: number) => `${formatCount(n)} ${n === 1 ? 'row' : 'rows'}`
const drafts = (n: number) => `${formatCount(n)} ${n === 1 ? 'draft' : 'drafts'}`
const products = (n: number) => `${formatCount(n)} ${n === 1 ? 'product' : 'products'}`

export const importCopy = {
  title: 'Bulk import',
  subtitle: 'Add many products at once from a spreadsheet. Imported products are created as drafts; nothing goes live until it is reviewed.',
  close: 'Close',
  steps: ['Download template', 'Upload file', 'Fix errors', 'Create drafts'],
  stepOf: (step: number, total: number, label: string) => `Step ${step} of ${total}: ${label}`,

  template: {
    intro: 'Start from our template so the columns match what we check. Fill in one row per size, keep the header row, and save it as .xlsx or .csv.',
    columnsTitle: 'Template columns',
    columns: [
      { name: 'Product ID', note: 'Required' },
      { name: 'Product name', note: 'Required' },
      { name: 'Category', note: 'Required' },
      { name: 'Description', note: null },
      { name: 'Price, MRP', note: 'Required' },
      { name: 'Stock qty', note: null },
      { name: 'Size', note: 'Required' },
      { name: 'Gender', note: null },
      { name: 'Material', note: null },
      { name: 'Image 1–3 (links)', note: '1 required' },
      { name: 'Returnable', note: 'Default: store policy' },
    ],
    sizesLabel: 'Sizes:',
    sizesNote: 'One row per size. Rows with the same Product ID become one product with several sizes.',
    download: 'Download template',
    downloading: 'Downloading…',
    fileName: 'shazlo-catalogue-template.csv',
    downloaded: 'Template downloaded. Fill it in, then upload it here.',
    downloadFailed: 'The template did not download. Check your connection and try again.',
    haveFile: 'I already have a file',
  },

  upload: {
    title: 'Upload your file',
    drop: 'Drop your .xlsx or .csv here, or',
    choose: 'choose a file',
    hint: 'Up to 10 MB. We check every row before anything is created.',
    inputLabel: 'Spreadsheet file',
    accept: '.xlsx,.xls,.csv',
    sending: (name: string) => `Uploading ${name}…`,
    checking: (name: string) => `Checking ${name}…`,
    checkingHint: 'This usually takes a few seconds. You can keep this open.',
    failed: 'We could not read this file. Check it is the Shazlo template saved as .xlsx or .csv, then upload it again.',
    back: 'Back',
  },

  review: {
    rows: (n: number) => rows(n),
    replace: 'Replace file',
    stats: {
      total: 'Rows in file',
      ok: 'Ready to import',
      okBaseline: 'Will be created as drafts',
      errors: 'Need fixing',
      errorsBaseline: 'Listed below',
      images: 'Image links failed',
      imagesBaseline: 'Product still created',
    },
    statsLabel: 'Import summary',
    errorsTitle: (n: number) => `${rows(n)} need${n === 1 ? 's' : ''} fixing`,
    columns: { row: 'Row', product: 'Product', column: 'Column', fix: 'What to fix' },
    rowLabel: (n: number) => `Row ${formatCount(n)}`,
    noProduct: '—',
    downloadReport: 'Download error report',
    reportFileName: 'shazlo-import-errors.csv',
    reportHeader: ['Row', 'Product', 'Column', 'What to fix'],
    allClearTitle: (n: number) => `All ${rows(n)} are ready`,
    allClearBody: 'Nothing to fix. Create the drafts, then add photos and submit them for review from Products.',
    footer: (n: number) => `${products(n)} will be created as drafts. You can check them and submit for review from Products.`,
    nothingReady: 'No rows are ready yet. Fix the rows listed above, then upload the file again.',
    uploadFixed: 'Upload fixed file',
    create: (n: number) => `Create ${drafts(n)}`,
    creating: 'Creating drafts…',
    createFailed: 'The drafts were not created.',
  },

  done: {
    title: (n: number) => `${drafts(n)} created`,
    body: 'Find them in Products under Drafts. Add photos and check the details, then submit them for review.',
    viewDrafts: 'View drafts',
    close: 'Close',
  },
} as const
