// One place that decides where the waitlist/registration backend lives.
// VITE_API_URL is the host only (no trailing slash, no "/api"), e.g. http://localhost:5000.
const DEFAULT_API_BASE = "https://shazlo-waitlist-gtge.onrender.com";

export function apiBase() {
  const configured = import.meta.env.VITE_API_URL;
  return (configured || DEFAULT_API_BASE).replace(/\/+$/, "");
}

// apiUrl("/api/waitlist/add") -> "<base>/api/waitlist/add", never with a doubled slash.
export function apiUrl(path) {
  return `${apiBase()}/${String(path).replace(/^\/+/, "")}`;
}
