import type { Schemas } from '../api/model'
import { isValidIfsc, normaliseIfsc } from '../lib/validators'

// Stand-in for an IFSC directory (vendor-api would use RBI's list or Razorpay's IFSC API). The
// first four letters name the bank; branches are made up but stable for a given code.
export const IFSC_BANKS: Record<string, string> = {
  SBIN: 'State Bank of India',
  HDFC: 'HDFC Bank',
  ICIC: 'ICICI Bank',
  UTIB: 'Axis Bank',
  KKBK: 'Kotak Mahindra Bank',
  PUNB: 'Punjab National Bank',
  BARB: 'Bank of Baroda',
  CNRB: 'Canara Bank',
  UBIN: 'Union Bank of India',
  IDIB: 'Indian Bank',
  YESB: 'Yes Bank',
  INDB: 'IndusInd Bank',
  IDFB: 'IDFC FIRST Bank',
}

const BRANCHES = [
  'Navrangpura, Ahmedabad', 'C G Road, Ahmedabad', 'Satellite, Ahmedabad', 'Ashram Road, Ahmedabad', 'Vastrapur, Ahmedabad',
  'Maninagar, Ahmedabad', 'Alkapuri, Vadodara', 'Athwa Lines, Surat', 'Kalawad Road, Rajkot', 'Station Road, Bhuj',
  'Fort, Mumbai', 'Connaught Place, New Delhi', 'Koramangala, Bengaluru', 'Park Street, Kolkata', 'Anna Nagar, Chennai',
  'Banjara Hills, Hyderabad', 'M I Road, Jaipur', 'F C Road, Pune',
]

export type IfscLookup = { ok: true; bank: Schemas['IfscBank'] } | { ok: false; reason: 'format' | 'unknown' }

export function lookupIfsc(raw: string): IfscLookup {
  const ifsc = normaliseIfsc(raw)
  if (!isValidIfsc(ifsc)) return { ok: false, reason: 'format' }
  const bank = IFSC_BANKS[ifsc.slice(0, 4)]
  if (!bank) return { ok: false, reason: 'unknown' }
  let h = 0
  for (const ch of ifsc.slice(5)) h = (h * 31 + ch.charCodeAt(0)) >>> 0
  return { ok: true, bank: { ifsc, bank, branch: BRANCHES[h % BRANCHES.length]! } }
}
