import { NextRequest, NextResponse } from "next/server";
import { rewriteCss, rewriteHtml, rewriteLocationHeader, relaxCspHeader } from "@/lib/proxy/rewrite";
import { ensureTargetUrl, isHttpProtocol } from "@/lib/proxy/utils";

// Prefer Edge runtime; works on Vercel Functions too.
export const runtime = "edge";
// Avoid caching of dynamic proxied responses
export const dynamic = "force-dynamic";
export const fetchCache = "force-no-store";

const HOP_BY_HOP = new Set([
  "connection",
  "keep-alive",
  "proxy-authenticate",
  "proxy-authorization",
  "te",
  "trailers",
  "transfer-encoding",
  "upgrade",
]);

function stripHopByHopHeaders(headers: Headers): Headers {
  const out = new Headers(headers);
  for (const h of HOP_BY_HOP) out.delete(h);
  // Let the platform decide compression; we may rewrite bodies.
  out.delete("accept-encoding");
  // Don't try to forward Host; many runtimes forbid it.
  out.delete("host");
  // Content-Length becomes invalid if we rewrite; delete defensively.
  out.delete("content-length");
  return out;
}

function buildFetchInit(req: NextRequest, upstreamUrl: URL): RequestInit {
  const method = req.method;
  const headers = new Headers(req.headers);

  // Normalize origin and referer to upstream origin (helps some CSRF protections)
  if (headers.has("origin")) {
    headers.set("origin", `${upstreamUrl.protocol}//${upstreamUrl.host}`);
  }
  if (headers.has("referer")) {
    try {
      const ref = new URL(headers.get("referer")!);
      headers.set("referer", `${upstreamUrl.protocol}//${upstreamUrl.host}${ref.pathname}${ref.search}`);
    } catch {
      headers.set("referer", `${upstreamUrl.protocol}//${upstreamUrl.host}/`);
    }
  }

  const init: RequestInit = {
    method,
    headers: stripHopByHopHeaders(headers),
    redirect: "manual",
  };

  if (method !== "GET" && method !== "HEAD") {
    // Pass through body stream in Edge runtime
    init.body = req.body;
  }
  return init;
}

function chooseContentType(headers: Headers): string {
  const ct = headers.get("content-type") || "";
  return ct.split(";")[0].trim().toLowerCase();
}

function collectSetCookies(h: Headers): string[] {
  const acc: string[] = [];
  // Non-standard getSetCookie may exist
  const anyHeaders = h as any;
  if (typeof anyHeaders.getSetCookie === "function") {
    try {
      const arr = anyHeaders.getSetCookie();
      if (Array.isArray(arr)) return arr;
    } catch {}
  }
  h.forEach((value, key) => {
    if (key.toLowerCase() === "set-cookie") acc.push(value);
  });
  return acc;
}

function rewriteSetCookie(headers: Headers) {
  // Pass through Set-Cookie but restrict to proxy path
  const setCookies = collectSetCookies(headers);
  if (setCookies.length === 0) return;
  headers.delete("set-cookie");
  for (const sc of setCookies) {
    let v = sc
      .replace(/;\s*Domain=[^;]*/i, "")
      .replace(/;\s*Path=[^;]*/i, "; Path=/api/proxy");
    headers.append("set-cookie", v);
  }
}

function relaxBlockingHeaders(headers: Headers, upstreamBaseHref: string) {
  // Adjust headers that commonly break proxied browsing
  if (headers.has("content-security-policy")) {
    const relaxed = relaxCspHeader(headers.get("content-security-policy")!);
    headers.set("content-security-policy", relaxed);
  }
  headers.delete("x-frame-options");
  headers.delete("cross-origin-opener-policy");
  headers.delete("cross-origin-embedder-policy");
  headers.delete("clear-site-data");
  // Redirects should keep going through the proxy
  if (headers.has("location")) {
    const proxied = rewriteLocationHeader(headers.get("location")!, upstreamBaseHref);
    headers.set("location", proxied);
  }
  rewriteSetCookie(headers);
  // Content length may change after rewriting
  headers.delete("content-length");
}

async function handleUpstream(req: NextRequest, upstream: URL) {
  const init = buildFetchInit(req, upstream);
  const res = await fetch(upstream, init);

  const headers = new Headers(res.headers);
  const ct = chooseContentType(headers);

  relaxBlockingHeaders(headers, upstream.href);

  if (ct === "text/html") {
    const text = await res.text();
    const rewritten = rewriteHtml(text, upstream.href);
    headers.set("cache-control", "no-store");
    return new NextResponse(rewritten, { status: res.status, headers });
  }

  if (ct === "text/css") {
    const text = await res.text();
    const rewritten = rewriteCss(text, upstream.href);
    headers.set("cache-control", "no-store");
    return new NextResponse(rewritten, { status: res.status, headers });
  }

  // Stream everything else
  return new NextResponse(res.body, { status: res.status, headers });
}

export async function GET(req: NextRequest) {
  const urlParam = req.nextUrl.searchParams.get("url");
  const upstream = ensureTargetUrl(urlParam);
  if (!upstream || !isHttpProtocol(upstream.href)) {
    return new NextResponse("Bad or missing url", { status: 400 });
  }
  return handleUpstream(req, upstream);
}

export async function POST(req: NextRequest) {
  const urlParam = req.nextUrl.searchParams.get("url") || req.headers.get("x-proxy-target");
  const upstream = ensureTargetUrl(urlParam);
  if (!upstream || !isHttpProtocol(upstream.href)) {
    return new NextResponse("Bad or missing url", { status: 400 });
  }
  return handleUpstream(req, upstream);
}

export async function HEAD(req: NextRequest) {
  const urlParam = req.nextUrl.searchParams.get("url");
  const upstream = ensureTargetUrl(urlParam);
  if (!upstream || !isHttpProtocol(upstream.href)) {
    return new NextResponse("Bad or missing url", { status: 400 });
  }
  const init = buildFetchInit(req, upstream);
  const res = await fetch(upstream, { ...init, method: "HEAD" });
  const headers = new Headers(res.headers);
  relaxBlockingHeaders(headers, upstream.href);
  return new NextResponse(null, { status: res.status, headers });
}