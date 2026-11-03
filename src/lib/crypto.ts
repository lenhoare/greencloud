/** Small Web Crypto helpers. Everything here runs natively in Workers. */

const encoder = new TextEncoder();

export function base64UrlEncode(bytes: ArrayBuffer | Uint8Array): string {
  const arr = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  let binary = "";
  for (const b of arr) binary += String.fromCharCode(b);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

export function base64UrlDecodeToString(input: string): string {
  const b64 = input.replace(/-/g, "+").replace(/_/g, "/");
  const binary = atob(b64 + "=".repeat((4 - (b64.length % 4)) % 4));
  const bytes = Uint8Array.from(binary, (c) => c.charCodeAt(0));
  return new TextDecoder().decode(bytes);
}

/** Cryptographically random, URL-safe token. 32 bytes = 256 bits of entropy. */
export function randomToken(byteLength = 32): string {
  return base64UrlEncode(crypto.getRandomValues(new Uint8Array(byteLength)));
}

export async function sha256Hex(input: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", encoder.encode(input));
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

/** PKCE S256 code challenge for a verifier (RFC 7636). */
export async function pkceChallenge(verifier: string): Promise<string> {
  return base64UrlEncode(await crypto.subtle.digest("SHA-256", encoder.encode(verifier)));
}

/** Constant-time string comparison, so secrets can't be guessed via timing. */
export function safeEqual(a: string, b: string): boolean {
  const ab = encoder.encode(a);
  const bb = encoder.encode(b);
  if (ab.byteLength !== bb.byteLength) return false;
  return crypto.subtle.timingSafeEqual(ab, bb);
}
