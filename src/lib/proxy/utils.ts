export function isHttpProtocol(u: string): boolean {
  try {
    const url = new URL(u);
    return url.protocol === "http:" || url.protocol === "https:";
  } catch {
    return false;
  }
}

export function absolutizeUrl(input: string, base: string): string {
  try {
    return new URL(input, base).href;
  } catch {
    return input;
  }
}

function encodeBase64(bytes: Uint8Array): string {
  // Convert bytes to binary string
  let binary = "";
  for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
  // btoa expects binary string
  return btoa(binary);
}

function decodeBase64(b64: string): Uint8Array {
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

export function b64urlEncode(input: string): string {
  const bytes = new TextEncoder().encode(input);
  const b64 = encodeBase64(bytes);
  return b64.replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

export function b64urlDecode(input: string): string {
  const pad = input.length % 4 === 0 ? "" : "=".repeat(4 - (input.length % 4));
  const s = input.replace(/-/g, "+").replace(/_/g, "/") + pad;
  const bytes = decodeBase64(s);
  return new TextDecoder().decode(bytes);
}

export function ensureTargetUrl(raw: string | null): URL | null {
  if (!raw) return null;
  try {
    if (raw.startsWith("http://") || raw.startsWith("https://")) {
      return new URL(raw);
    }
    // try base64url decode
    const dec = b64urlDecode(raw);
    return new URL(dec);
  } catch {
    return null;
  }
}

export function proxifyUrl(u: string, base: string, prefix = "/api/proxy?url="): string {
  const abs = absolutizeUrl(u, base);
  if (!isHttpProtocol(abs)) return u;
  return `${prefix}${encodeURIComponent(abs)}`;
}

export function sanitizeHeaderValue(val: string): string {
  return val.replace(/[\r\n]/g, " ").slice(0, 8192);
}