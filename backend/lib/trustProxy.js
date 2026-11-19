// How Express derives req.ip, which the rate limiters key on.
//
// Unset (the default): trust no proxy, so req.ip is the TCP peer. That is right when clients
// connect directly (local development, tests). Behind a hosting proxy it makes every client
// share the proxy's address and therefore one rate-limit budget, so a deployment behind a
// proxy must set TRUST_PROXY to the number of proxy hops in front of the app (Express then
// takes the address that many entries from the right of X-Forwarded-For), or to the proxies'
// addresses or subnets ("loopback", "uniquelocal", "10.0.0.0/8", comma-separated).
//
// "true" is refused: it trusts the left-most X-Forwarded-For entry, which any client can set,
// so it would let every request pick its own rate-limit key.

export function parseTrustProxy(value) {
  const setting = (value ?? "").trim();
  if (setting === "" || setting.toLowerCase() === "false") return false;
  if (/^\d+$/.test(setting)) return Number(setting);
  if (setting.toLowerCase() === "true") {
    throw new Error(
      "TRUST_PROXY=true would trust a client-supplied X-Forwarded-For header; set the number of proxy hops instead",
    );
  }
  const entries = setting.split(",").map((entry) => entry.trim()).filter(Boolean);
  // A /0 subnet (0.0.0.0/0, ::/0) matches every address, which is the same as "true".
  const everything = entries.find((entry) => /\/0+$/.test(entry));
  if (everything) {
    throw new Error(
      `TRUST_PROXY=${everything} would trust every address, including a client-supplied X-Forwarded-For; set the number of proxy hops instead`,
    );
  }
  return entries;
}
