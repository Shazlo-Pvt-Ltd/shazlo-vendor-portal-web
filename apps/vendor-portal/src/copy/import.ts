import type { Schemas } from '../api/client'
import { formatCount } from '../lib/format'

// Copy for Bulk import (V-08). Column labels are in ./catalog.ts (importColumns). One module per
// screen keeps a later Hindi translation in one place.
const rows = (n: number) => `${formatCount(n)} ${n === 1 ? 'row' : 'rows'}`
const drafts = (n: number) => `${formatCount(n)} ${n === 1 ? 'draft' : 'drafts'}`
const products = (n: number) => `${formatCount(n)} ${n === 1 ? 'product' : 'products'}`
const photos = (n: number) => `${formatCount(n)} ${n === 1 ? 'photo' : 'photos'}`

export const importCopy = {
  title: 'Bulk import',
  subtitle: 'Add many products at once from a spreadsheet. They are saved as drafts; nothing goes live until our team reviews it.',
  close: 'Close',
  steps: ['Download template', 'Upload file', 'Fix errors', 'Add photos'],
  stepOf: (step: number, total: number, label: string) => `Step ${step} of ${total}: ${label}`,

  laptop: {
    title: 'Easier on a laptop',
    body: 'Spreadsheets are hard to fill in and fix on a phone. You can still upload here and read what to fix.',
  },

  template: {
    intro: 'Start from our template so the columns match what we check. Use one row per product, with all its sizes in one cell. Keep the header row and save it as .xlsx or .csv.',
    columnsTitle: 'Template columns',
    required: 'Required',
    optional: 'Optional',
    exampleTitle: 'Example row',
    // The example row from the requirements (PDF §4), one value per template column.
    example: {
      product_name: 'Relaxed Linen Shirt',
      gender: 'Men',
      product_type: 'Shirts',
      main_colour: 'Beige',
      other_colours: 'White',
      selling_price: '1899',
      sizes_stock: 'S:4, M:6, L:3, XL:0',
      description: 'Relaxed shirt in washed linen with a camp collar. Machine wash cold.',
      material: '100% linen',
      mrp: '2499',
    } satisfies Record<Schemas['ImportColumn'], string>,
    sizesLabel: 'Sizes and stock:',
    sizesNote: 'Write each size and how many you have, like S:4, M:6, L:3, XL:0. Use 0 for a sold-out size.',
    photosNote: 'Photos are not in the sheet. Once the drafts are made, add photos named after each product, like “Relaxed Linen Shirt - front.jpg”.',
    download: 'Download template',
    downloading: 'Downloading…',
    fileName: 'shazlo-products-template.csv',
    downloaded: 'Template downloaded. Fill it in, then upload it here.',
    downloadFailed: 'The template did not download. Check your connection and try again.',
    haveFile: 'I already have a file',
  },

  upload: {
    title: 'Upload your file',
    drop: 'Drop your .xlsx or .csv here, or',
    choose: 'choose a file',
    hint: 'Up to 10 MB. We check every row before anything is made.',
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
      ok: 'Ready',
      okBaseline: 'Will be saved as drafts',
      errors: 'Need fixing',
      errorsBaseline: 'Listed below',
    },
    statsLabel: 'Import summary',
    errorsTitle: (n: number) => `${rows(n)} need${n === 1 ? 's' : ''} fixing`,
    columns: { row: 'Row', product: 'Product', column: 'Column', fix: 'What to fix' },
    rowLabel: (n: number) => `Row ${formatCount(n)}`,
    wholeRow: 'Whole row',
    noProduct: '—',
    downloadReport: 'Download what to fix',
    reportFileName: 'shazlo-import-fixes.csv',
    reportHeader: ['Row', 'Product', 'Column', 'What to fix'],
    allClearTitle: (n: number) => `All ${rows(n)} are ready`,
    allClearBody: 'Nothing to fix. Save them as drafts, then add their photos.',
    footer: (n: number) => `${products(n)} will be saved as drafts. Next, you can add their photos.`,
    nothingReady: 'No rows are ready yet. Fix the rows listed above, then upload the file again.',
    uploadFixed: 'Upload fixed file',
    create: (n: number) => `Save ${drafts(n)}`,
    creating: 'Saving drafts…',
    createFailed: 'The drafts were not saved.',
  },

  photos: {
    title: (n: number) => `${drafts(n)} saved`,
    intro: 'Now add their photos. Name each photo after its product and we put it in the right place. Add front, back, detail, worn or tryon to the name to choose the slot.',
    exampleName: 'For example: Relaxed Linen Shirt - front.jpg',
    drop: 'Drop photos or a folder here, or',
    choose: 'choose photos',
    chooseFolder: 'Choose a folder',
    inputLabel: 'Photo files',
    folderLabel: 'Folder of photos',
    matchedTitle: (n: number) => `${photos(n)} matched`,
    matchedLabel: 'Matched photos',
    unmatchedTitle: (n: number) => `${photos(n)} did not match a product`,
    unmatchedLabel: 'Photos that did not match',
    unmatchedHint: 'Rename them to start with the product name and add them again, or add them later from each product.',
    noRoomTitle: (n: number) => `${photos(n)} had no free slot`,
    noRoomHint: 'Each product takes 4 product photos, 4 extra and 5 try-on photos.',
    file: (name: string, product: string, slot: string) => `${name} → ${product}, ${slot}`,
    states: { waiting: 'Ready to add', preparing: 'Getting it ready…', uploading: 'Uploading…', done: 'Added', failed: 'Not added' },
    retry: 'Try again',
    retryLabel: (name: string) => `Try again: ${name}`,
    unreadable: 'We could not open this photo on this device. Save it as a JPG and try again.',
    progress: (done: number, total: number) => `${formatCount(done)} of ${photos(total)} added`,
    add: (n: number) => `Add ${photos(n)}`,
    adding: 'Adding photos…',
    allDone: (n: number) => `${photos(n)} added. Check each draft, then send it for review from Products.`,
    someFailed: (n: number) => `${photos(n)} did not upload. Try them again, or add them later from each product.`,
    skip: 'Add photos later',
    viewDrafts: 'View drafts',
  },
} as const
