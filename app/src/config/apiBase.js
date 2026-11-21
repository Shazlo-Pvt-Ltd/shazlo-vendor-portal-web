// One place that decides where the waitlist/registration backend lives.
// VITE_API_URL is the host only, e.g. http://localhost:5000. Older configuration used a value that
// ended in "/api" (the old api.js fallback and the old .env did), so a trailing "/api", stray
// slashes and surrounding spaces are accepted and removed: the URLs below never become /api/api.
const DEFAULT_API_BASE = "https://shazlo-waitlist-gtge.onrender.com";

function cleanBase(value) {
  return String(value ?? "")
    .trim()
    .replace(/\/+$/, "")
    // "([^/:])" keeps a host that is literally named "api" (https://api.example.com) intact.
    .replace(/([^/:])\/+api$/i, "$1");
}

export function apiBase() {
  return cleanBase(import.meta.env.VITE_API_URL) || DEFAULT_API_BASE;
}

// apiUrl("/api/waitlist/add") -> "<base>/api/waitlist/add", never with a doubled slash.
export function apiUrl(path) {
  return `${apiBase()}/${String(path).replace(/^\/+/, "")}`;
}
