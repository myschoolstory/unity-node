import { NextRequest, NextResponse } from "next/server";

export const runtime = "edge";

// A tiny service-worker script to install. It shells requests back to our proxy path.
// We serve it under /api/proxy/sw so it can be registered from any proxied page.
const SW = `
self.addEventListener('install', (e) => { self.skipWaiting(); });
self.addEventListener('activate', (e) => { e.waitUntil(self.clients.claim()); });

const PREFIX = '/api/proxy?url=';

function proxify(input, base) {
  try {
    const u = new URL(input, base);
    if (u.protocol === 'http:' || u.protocol === 'https:') {
      return PREFIX + encodeURIComponent(u.href);
    }
  } catch {}
  return input;
}

self.addEventListener('fetch', (event) => {
  const req = event.request;
  const url = new URL(req.url);
  // Only rewrite if navigating a client that was loaded via the proxy
  const referer = req.headers.get('referer');
  if (!referer) return; // don't interfere with direct loads
  let targetBase = referer;
  try { targetBase = decodeURIComponent((new URL(referer)).searchParams.get('url') || referer); } catch {}

  // For navigations and same-origin subresources, redirect through the proxy.
  if (req.mode === 'navigate' || url.origin === location.origin) {
    const to = proxify(url.href, targetBase);
    if (to !== url.href) {
      event.respondWith(Response.redirect(to, 302));
      return;
    }
  }
});
`;

export async function GET(req: NextRequest) {
  return new NextResponse(SW, {
    headers: {
      "content-type": "application/javascript; charset=utf-8",
      "cache-control": "no-store",
      "Service-Worker-Allowed": "/api/proxy",
    },
  });
}