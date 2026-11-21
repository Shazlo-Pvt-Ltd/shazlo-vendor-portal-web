import type { Schemas } from '../api/model'

// A complete Build 2 sign-up (V-02) that passes every check: the brand delivers itself, takes no
// returns, and is paid into an HDFC account. Tests change one field at a time from here.
export const validApplication: Schemas['VendorApplication'] = {
  brand_name: 'Neel Threads',
  sells: 'both',
  city: 'Surat',
  owner_name: 'Asha Patel',
  phone: '+91 98765 43210',
  email: 'asha@neelthreads.in',
  delivery: { mode: 'own', areas: { all_india: false, places: ['Surat', '395007'] }, delivery_days: '2_3' },
  returns: { window_days: 0, condition: null, refund_days: null },
  pay_on_delivery: { cash: true, upi: true },
  payout: { method: 'bank', holder_name: 'Neel Threads', account_number: '5010 0123 4567 4821', ifsc: 'hdfc0001234' },
  agreed_terms: true,
  agreed_price_rule: true,
}
