// Helpers for "LAN multiplayer" mode: a host runs the OpenFront dev server on
// their machine (see `npm run lan`) and friends on the same network connect to
// the host's LAN address in a browser. No openfront.io account, external auth
// API, or CAPTCHA is involved — LAN players join as local guests.
//
// The whole feature is detection-based: we look at the hostname in the browser
// URL. When a player opens a private LAN address (e.g. http://192.168.1.42:9000)
// we treat them as a guest and skip every call to the external API, which on a
// LAN has no DNS entry and would otherwise spew failed requests before the code
// falls back to guest mode anyway.

const LOOPBACK_HOSTNAMES = new Set(["localhost", "127.0.0.1", "::1", "[::1]"]);

/** localhost / loopback — the host's own machine. */
export function isLoopbackHost(hostname: string): boolean {
  return LOOPBACK_HOSTNAMES.has(hostname.toLowerCase());
}

/**
 * True when `hostname` is a private/LAN address that can't resolve the public
 * OpenFront API: an RFC1918 IPv4 range, a link-local address, an mDNS `.local`
 * name, or a bare single-label hostname (e.g. "my-laptop"). Loopback is
 * included so the host themselves is treated consistently.
 */
export function isLanHost(hostname: string): boolean {
  const host = hostname.toLowerCase().replace(/^\[|\]$/g, "");
  if (isLoopbackHost(host)) return true;
  if (host.endsWith(".local")) return true;

  // Private IPv4 ranges (RFC1918) + link-local.
  const ipv4 = host.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
  if (ipv4) {
    const [a, b] = [Number(ipv4[1]), Number(ipv4[2])];
    if (a === 10) return true;
    if (a === 192 && b === 168) return true;
    if (a === 172 && b >= 16 && b <= 31) return true;
    if (a === 169 && b === 254) return true;
    if (a === 127) return true;
    return false;
  }

  // Bare single-label hostname (no dots) — a NetBIOS/mDNS LAN name.
  if (!host.includes(".") && host !== "") return true;

  return false;
}

/**
 * True when the current page is being served from a private LAN address that is
 * NOT plain loopback. These are the connections that must run as offline guests:
 * a friend who typed the host's IP. Loopback is excluded so the standard
 * `npm run dev` workflow on localhost keeps its normal (account-capable) auth
 * behavior, where a developer may run the real API on :8787.
 */
export function isLanGuestSession(): boolean {
  if (typeof window === "undefined") return false;
  const { hostname } = window.location;
  return isLanHost(hostname) && !isLoopbackHost(hostname);
}

/**
 * The URL a host shares with friends to join their LAN game — the origin of the
 * current page. Only meaningful when the page itself is on a LAN address;
 * callers should pair this with {@link isShareableLanOrigin}.
 */
export function getLanShareUrl(): string {
  return window.location.origin;
}

/**
 * True when the current origin is something other machines on the LAN can
 * actually reach (i.e. not loopback). When false, the host opened localhost and
 * should be told to use their LAN IP instead.
 */
export function isShareableLanOrigin(): boolean {
  if (typeof window === "undefined") return false;
  return !isLoopbackHost(window.location.hostname);
}
