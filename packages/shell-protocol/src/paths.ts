// A path inside a module: what `navigate` and `title` carry, and the links in a module's manifest
// and summary. The shell puts it after the module's base path ("/vendors" + "/queue"), so it must
// never escape that: no protocol-relative "//host", no backslash (browsers read "/\host" as
// "//host"), no "." or ".." segments (plain or percent-encoded), no whitespace or control
// characters. A query string is fine ("/publishing?status=failed").
//
// The message validators (validate.ts) and the zod schemas of the manifest and the summary use this
// one check, so a path a module may send is a path the shell may link to, and the other way round.
export const MAX_MODULE_PATH = 512

export function isModulePath(value: unknown): value is string {
  if (typeof value !== 'string') return false
  if (value.length === 0 || value.length > MAX_MODULE_PATH) return false
  if (!value.startsWith('/') || value.startsWith('//')) return false
  // eslint-disable-next-line no-control-regex
  if (/[\\\s\u0000-\u001f\u007f]/.test(value)) return false
  const path = value.split(/[?#]/, 1)[0] ?? ''
  return !path.split('/').some((segment) => segment === '.' || segment === '..' || /^%2e(%2e)?$/i.test(segment) || /^\.%2e$|^%2e\.$/i.test(segment))
}
