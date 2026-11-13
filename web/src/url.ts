// Resolve backend URLs against the page origin. In dev, Vite proxies HTTP and
// WebSocket to the Python server, so a phone on the LAN (and the preview)
// reach the feed through the page, not through a hardcoded loopback port.

const PREVIEW_HOSTS = new Set([
  "preview.grok.genai.mil",
  "preview.grok.mil",
  "preview.grokgsac.com",
]);

/** Path prefix that a path-based preview keeps in the browser URL. */
function publicPrefix(): string {
  if (typeof window === "undefined") return "";
  if (!PREVIEW_HOSTS.has(window.location.hostname.toLowerCase())) return "";
  const match = window.location.pathname.match(/^\/hds-[a-z0-9]+-\d+-[a-z0-9]+/i);
  return match ? match[0] : "";
}

export function getUrl(schema: string, secureSchema: string, path: string): string {
  const suffix = `${publicPrefix()}/${path}`.replace(/\/{2,}/g, "/");
  if (window.location.protocol === "https:") {
    return `${secureSchema}://${window.location.host}${suffix}`;
  }
  // Same origin in dev and in the built app. The Python server serves the
  // page and the feed together, so a published port other than 5000
  // (Docker on 8080, a phone on the LAN) still reaches the data.
  return `${schema}://${window.location.host}${suffix}`;
}

export function getHttpUrl(path: string): string {
  return getUrl("http", "https", path);
}

export function getWebSocketUrl(path: string): string {
  return getUrl("ws", "wss", path);
}
