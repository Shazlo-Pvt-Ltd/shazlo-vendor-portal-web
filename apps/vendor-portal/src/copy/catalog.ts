import type { Schemas } from '../api/model'
import type { Measurement, NamedPhotoAngle } from '../lib/catalog'

// Labels and messages for the shared option lists (values in src/lib/catalog.ts) and the store
// details (src/lib/storeDetails.ts). The mock API uses the same messages, so what a screen checks
// and what the server answers read alike. One module, so a Hindi version can sit beside it later.

type S = Schemas

const list = (items: readonly string[]) =>
  items.length <= 1 ? (items[0] ?? '') : `${items.slice(0, -1).join(', ')} and ${items[items.length - 1]}`

export const catalogCopy = {
  genders: { Women: 'Women', Men: 'Men', Unisex: 'Unisex' } satisfies Record<S['Gender'], string>,

  sells: { women: 'Women', men: 'Men', both: 'Both' } satisfies Record<S['Sells'], string>,

  // The values are already the words sellers see; this map is where a translation would go.
  productTypes: {
    Kurtas: 'Kurtas', Kurtis: 'Kurtis', Sarees: 'Sarees', Lehengas: 'Lehengas', Dupattas: 'Dupattas', Stoles: 'Stoles',
    Shirts: 'Shirts', 'T-shirts': 'T-shirts', Tops: 'Tops', Dresses: 'Dresses', 'Co-ords': 'Co-ords',
    Skirts: 'Skirts', Jeans: 'Jeans', Trousers: 'Trousers', Palazzos: 'Palazzos', Jackets: 'Jackets', Blazers: 'Blazers',
  } satisfies Record<S['ProductType'], string>,

  sizeChart: {
    groups: { bottoms: 'Bottoms', tops: 'Tops', dresses: 'Dresses and kurtas', jackets: 'Jackets' } satisfies Record<S['SizeChartGroup'], string>,
    measurements: {
      waist: 'Waist', hip: 'Hip', inseam: 'Inseam', length: 'Length', chest: 'Chest', shoulder: 'Shoulder', sleeve: 'Sleeve', bust: 'Bust',
    } satisfies Record<Measurement, string>,
    unit: 'cm',
    // "Used for all your shirts, T-shirts and tops"
    usedFor: (types: readonly string[]) => `Used for all your ${list(types.map((t) => (t === 'T-shirts' ? t : t.toLowerCase())))}`,
    none: 'This product type does not need a size chart.',
  },

  sizes: { oneSize: 'One size', waist: 'Waist sizes' },

  colours: {
    main: 'Main colour',
    other: 'Other colours (optional)',
    otherHint: 'Up to 2.',
  },

  photoSlots: { front: 'Front', back: 'Back', detail: 'Detail', worn: 'Worn' } satisfies Record<NamedPhotoAngle, string>,
  photoAngles: { front: 'Front', back: 'Back', detail: 'Detail', worn: 'Worn', extra: 'Extra', tryon: 'Try-on' } satisfies Record<S['PhotoAngle'], string>,

  delivery: {
    modes: {
      shazlo: { label: 'Shazlo delivery service', hint: 'We pick up from you.' },
      own: { label: 'We deliver ourselves', hint: 'You send orders with your own courier.' },
    } satisfies Record<S['Delivery']['mode'], { label: string; hint: string }>,
    days: { '1_2': '1–2 days', '2_3': '2–3 days', '3_5': '3–5 days', '5_7': '5–7 days' } satisfies Record<S['DeliveryDays'], string>,
    allIndia: 'All of India',
    places: 'Chosen cities or PIN codes',
  },

  returns: {
    windows: { 0: 'No returns', 7: '7 days', 14: '14 days', 30: '30 days' } satisfies Record<S['ReturnWindowDays'], string>,
    conditions: {
      unworn_with_tags: 'Unworn with tags',
      any_reason: 'Any reason',
      damaged_or_wrong: 'Only damaged or wrong items',
    } satisfies Record<S['ReturnCondition'], string>,
    refunds: {
      2: '2 working days after pickup',
      5: '5 working days after pickup',
      7: '7 working days after pickup',
    } satisfies Record<S['RefundDays'], string>,
  },

  payOnDelivery: { cash: 'Cash on delivery', upi: 'UPI on delivery' } satisfies Record<keyof S['PayOnDelivery'], string>,

  payoutMethods: { bank: 'Bank account', upi: 'UPI ID' } satisfies Record<S['PayoutInput']['method'], string>,

  // Store details topics, in page order. business is optional and never "To do".
  storeTopics: {
    brand: 'Your brand',
    contact: 'Contact',
    delivery: 'Delivery',
    returns: 'Returns',
    pay_on_delivery: 'Payment on delivery',
    payout: 'Payouts',
  } satisfies Record<S['StoreTopic'], string>,
  businessTopic: 'Business details',

  // Checklist lines for sending a product for review, keyed like the submit 422.
  submitRequirements: {
    title: 'Name',
    gender: 'Gender',
    category: 'Product type',
    main_colour: 'Main colour',
    material: 'Material',
    description: 'Description',
    photos: '4 product photos',
    tryon: '5 try-on photos',
    variants: 'At least one size',
    price_paise: 'Selling price',
    store_details: 'Store details',
  } satisfies Record<S['SubmitRequirement'], string>,

  importColumns: {
    product_name: 'Product name',
    gender: 'Gender',
    product_type: 'Product type',
    main_colour: 'Main colour',
    other_colours: 'Other colours',
    selling_price: 'Selling price',
    sizes_stock: 'Sizes and stock',
    description: 'Description',
    material: 'Material',
    mrp: 'MRP',
  } satisfies Record<S['ImportColumn'], string>,

  errors: {
    brand: {
      storeNameRequired: 'Add your store name.',
      storeNameLong: 'Keep your store name under 80 characters.',
      sellsRequired: 'Choose who you sell for: women, men or both.',
      cityRequired: 'Add the city or area you ship from, like Ahmedabad.',
      linkFormat: 'Enter an Instagram handle like @kalki.studio or a website like kalkistudio.in.',
    },
    contact: {
      nameRequired: 'Add your name.',
      phoneRequired: 'Enter your mobile number.',
      phoneFormat: 'Enter a 10-digit Indian mobile number, like 98250 12345.',
      emailRequired: 'Enter your email.',
      emailFormat: 'Enter an email like name@brand.in.',
    },
    delivery: {
      modeRequired: 'Choose who delivers your orders.',
      line1Required: 'Add the address: house or shop number, building and street.',
      areaRequired: 'Add the area.',
      cityRequired: 'Add the city.',
      pinRequired: 'Add the PIN code.',
      pinFormat: 'Enter a 6-digit PIN code, like 380015.',
      areasRequired: 'Choose All of India, or add the cities or PIN codes you deliver to.',
      placePin: (place: string) => `"${place}" is not a PIN code. A PIN code has 6 digits, like 380015.`,
      tooManyPlaces: 'Add up to 50 cities or PIN codes, or choose All of India.',
      daysRequired: 'Choose how long delivery takes.',
    },
    returns: {
      windowRequired: 'Choose a return window.',
      conditionRequired: 'Choose which returns you accept.',
      refundRequired: 'Choose how soon you refund.',
    },
    payOnDelivery: {
      atLeastOne: 'Choose at least one: cash on delivery or UPI on delivery.',
    },
    payout: {
      methodRequired: 'Choose a bank account or a UPI ID.',
      holderRequired: 'Add the account holder name, as the bank has it.',
      accountRequired: 'Enter the account number.',
      accountFormat: 'Enter the account number: 9 to 18 digits.',
      ifscRequired: 'Enter the IFSC code.',
      ifscFormat: 'Enter the 11-character IFSC code, like HDFC0001234. It is on your cheque book.',
      ifscUnknown: 'We could not find this IFSC code. Check it on your cheque book or bank app.',
      upiRequired: 'Enter your UPI ID.',
      upiFormat: 'Enter a UPI ID like name@okhdfcbank.',
    },
    business: {
      legalNameRequired: 'Add your legal business name.',
      legalNameLong: 'Keep the legal name under 120 characters.',
      gstChoice: 'Say whether your business is registered for GST.',
      gstinRequired: 'Enter your GST number.',
      gstinFormat: 'Check your GST number. It has 15 characters, like 24ABCDE1234F1Z6.',
    },
    commission: {
      choice: 'Choose how we set your commission.',
      required: 'Enter the rate you propose, like 12 or 12.5.',
      range: 'Enter a rate from 0% to 40%.',
      format: 'Enter a percentage, like 12 or 12.5.',
      sameAsAgreed: 'That is already your agreed rate.',
    },
    application: {
      agreeTerms: 'Agree to the seller terms to send your application.',
      agreePriceRule: 'Agree to the price rule to send your application.',
    },
    product: {
      titleRequired: 'Add a name.',
      genderRequired: 'Choose who it is for: women, men or unisex.',
      categoryRequired: 'Choose a product type.',
      categoryUnknown: 'Choose a product type from the list.',
      genderUnknown: 'Choose women, men or unisex.',
      mainColourRequired: 'Choose the main colour.',
      colourUnknown: (name: string) => `"${name}" is not one of our colours. Choose one from the list.`,
      otherColoursMax: 'Choose up to 2 other colours.',
      otherColoursRepeat: 'Other colours should be different from the main colour and from each other.',
      materialRequired: 'Add the material, like 100% linen.',
      materialLong: 'Keep the material under 120 characters.',
      descriptionRequired: 'Add a description.',
      photosMissing: (labels: readonly string[]) => `Add the ${list(labels.map((l) => l.toLowerCase()))} photo${labels.length === 1 ? '' : 's'}.`,
      tryonMissing: (more: number) => `Add ${more} more try-on photo${more === 1 ? '' : 's'}. We need 5 photos of real people wearing it.`,
      variantsRequired: 'Add at least one size.',
      sizeUnknown: (size: string) => `"${size}" is not a size we list. Use XS to 3XL, One size, or a waist size from 26 to 40.`,
      priceRequired: 'Add a selling price.',
      priceZero: 'Enter a price above ₹0.',
      priceAboveMrp: 'Selling price cannot be above the MRP.',
      storeDetailsIncomplete: 'Finish your store details first.',
      submitProblems: 'Fix these before sending for review',
      extraFull: 'You can add up to 4 extra photos.',
      tryonFull: 'You can add up to 5 try-on photos.',
    },
    // Any colour name or hex code (src/lib/catalog.ts parseColour). The example is passed in, so no
    // colour is written here.
    colour: {
      hex: (example: string) => `Enter a hex code as # and 6 digits or letters A to F, like ${example}.`,
      long: (max: number) => `Keep the colour name to ${max} characters.`,
      name: 'Enter a colour name, like Rust orange, or a hex code.',
    },
    sizeChart: {
      sizeUnknown: (size: string) => `"${size}" is not a size we list.`,
      measurementUnknown: (name: string) => `"${name}" is not measured for this size chart.`,
      value: 'Enter centimetres above 0 and up to 300, like 96 or 96.5.',
    },
    import: {
      missingColumn: 'This column is missing. Download the template and copy your rows into it.',
      required: (label: string) => `Required. Add the ${label.toLowerCase()}.`,
      nameRequired: 'Required. Add a product name.',
      nameRepeated: (row: number) => `This product name is also on row ${row}. Use one row per product, with all its sizes in Sizes and stock.`,
      gender: (value: string) => `"${value}" is not a gender we list. Use Women, Men or Unisex.`,
      productType: (value: string, closest: string | null) => `"${value}" is not a product type we list.${closest ? ` Closest match: ${closest}.` : ''}`,
      colour: (value: string, fix: string) => `Could not read "${value}" as a colour. ${fix}`,
      otherColoursMax: 'Add up to 2 other colours, separated by commas.',
      otherColoursRepeat: 'Other colours should be different from the main colour and from each other.',
      price: (value: string) => `Must be a number above 0, like 1299. Found "${value}".`,
      mrpBelowPrice: 'The MRP must be at least the selling price.',
      sizesEmpty: 'Required. Write each size and its stock, like S:4, M:6, L:3.',
      sizesFormat: (part: string) => `Could not read "${part}". Write each size and its stock, like S:4, M:6, L:3.`,
      sizesUnknown: (size: string) => `"${size}" is not a size we list. Use XS to 3XL, One size, or a waist size from 26 to 40.`,
      sizesRepeat: (size: string) => `${size} is listed twice. Write each size once.`,
    },
  },
} as const
