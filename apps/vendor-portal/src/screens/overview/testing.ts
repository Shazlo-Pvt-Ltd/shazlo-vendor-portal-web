import { emptyStore, nextId, NOT_SET, type MockDb } from '../../mocks/db'

/** A brand that has just signed up and verified its email: nothing saved, sent or decided yet. */
export const NEW_SELLER = { email: 'asha@neelthreads.in', password: 'neel-threads-2026' }

/** Adds {@link NEW_SELLER} to the mock database, waiting for Shazlo's approval as after sign-up. */
export function addNewSeller(db: MockDb, status: 'pending' | 'approved' = 'pending') {
  const at = db.now().toISOString()
  const vendor = { id: nextId(db), name: 'Neel Threads', slug: 'neel-threads', status, created_at: at }
  db.vendors.push(vendor)
  db.users.push({ id: nextId(db), vendor_id: vendor.id, email: NEW_SELLER.email, password: NEW_SELLER.password, role: 'owner', status: 'active', verified: true, last_login_at: null, created_at: at })
  db.stores.set(vendor.id, emptyStore())
  db.commissions.set(vendor.id, NOT_SET)
  return vendor
}

/** Kalki Studio, the demo seller. */
export const kalkiOf = (db: MockDb) => db.vendors.find((v) => v.name === 'Kalki Studio')!

/** Kalki's live brand page goes away, as if it had never been approved. */
export function unpublishBrandPage(db: MockDb) {
  for (const version of db.brands.get(kalkiOf(db).id) ?? []) if (version.state === 'published') version.state = 'superseded'
}

/** Kalki's store details become complete: a bank account is saved. */
export function completeStoreDetails(db: MockDb) {
  db.stores.get(kalkiOf(db).id)!.payout = { method: 'bank', holder_name: 'Kalki Studio LLP', account_number: '50100123454821', ifsc: 'HDFC0001234' }
}
