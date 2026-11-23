// Input checks shared by the routes and models. Every value that reaches a MongoDB query must
// first be proven to be a string here or in the handler: a JSON or urlencoded body can carry an
// object such as {"$gt": ""}, which MongoDB would read as an operator and match every record.

// RFC 5321 caps a forward path at 256 octets, which leaves 254 for the address itself.
const MAX_EMAIL_LENGTH = 254;

// Every character can be claimed by exactly one part of this pattern: the local part stops at
// the only "@", and each domain label stops at the next ".", so a failed match never retries a
// split and matching is linear in the input. The pattern it replaces nested quantifiers over
// \w and backtracked exponentially on inputs like "a@a" + "a".repeat(30) (CodeQL js/redos).
export const EMAIL_PATTERN = /^[^\s@]+@[^\s@.]+(?:\.[^\s@.]+)+$/;

/** A deliberately permissive address check: one "@", no whitespace, a dotted domain, at most 254 characters. */
export function isValidEmail(value) {
  return typeof value === "string" && value.length <= MAX_EMAIL_LENGTH && EMAIL_PATTERN.test(value);
}

const OBJECT_ID_PATTERN = /^[a-f\d]{24}$/i;

/**
 * True only for the 24-hex-character form of a MongoDB ObjectId. Stricter than
 * mongoose.isValidObjectId, which also accepts any 12-character string.
 */
export function isObjectIdString(value) {
  return typeof value === "string" && OBJECT_ID_PATTERN.test(value);
}

/** A non-null object that is not an array: the shape of one catalog row. */
export function isPlainObject(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
