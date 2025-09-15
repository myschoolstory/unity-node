import { absolutizeUrl, proxifyUrl, sanitizeHeaderValue } from "./utils";

const URL_ATTRS = [
  "href",
  "src",
  "action",
  "poster",
  "data",
  "formaction",
  "srcset",
];

const JS_MITIGATION = `
(() => {
  // Basic patch for fetch, XHR, EventSource, WebSocket
  var __PREFIX = window.__PROXY_PREFIX || "/api/proxy?url=";
  var __ORIGIN = window.__PROXY_ORIGIN || (function () {
    try {
      var sp = new URLSearchParams(location.search);
      return sp.get("url") || "";
    } catch (e) { return ""; }
  })();

  function isProxied(u) {
    try {
      var p = new URL(u, location.href);
      return p.pathname === "/api/proxy" && p.searchParams.has("url");
    } catch (e) { return false; }
  }

  function toProxy(u) {
    try {
      if (isProxied(u)) return u;
      var base = new URL(decodeURIComponent(__ORIGIN) || location.href);
      var abs = new URL(u, base);
      if (abs.protocol === "http:" || abs.protocol === "https:") {
        return __PREFIX + encodeURIComponent(abs.href);
      }
    } catch (e) {}
    return u;
  }

  var _fetch = window.fetch;
  window.fetch = function (input, init) {
    try {
      if (typeof input === "string") {
        input = toProxy(input);
      } else if (input && typeof input === "object" && "url" in input) {
        input = new Request(toProxy(input.url), input);
      }
    } catch (e) {}
    return _fetch(input, init);
  };

  var _open = XMLHttpRequest.prototype.open;
  XMLHttpRequest.prototype.open = function (method, url) {
    try { url = toProxy(url); } catch (e) {}
    var args = Array.prototype.slice.call(arguments, 2);
    return _open.apply(this, [method, url].concat(args));
  };

  var _WS = window.WebSocket;
  if (_WS) {
    var PatchedWS = function (url, protocols) {
      try { url = toProxy(url); } catch (e) {}
      return new _WS(url, protocols);
    };
    PatchedWS.prototype = _WS.prototype;
    window.WebSocket = PatchedWS;
  }

  var _ES = window.EventSource;
  if (_ES) {
    window.EventSource = function (url, conf) {
      try { url = toProxy(url); } catch (e) {}
      return new _ES(url, conf);
    };
  }

  // Register service worker for deeper interception if available
  if ("serviceWorker" in navigator) {
    try {
      var base2 = new URL(decodeURIComponent(__ORIGIN) || location.href);
      navigator.serviceWorker.register("/api/proxy/sw?origin=" + encodeURIComponent(base2.origin), { scope: "/api/proxy" });
    } catch (e) {}
  }
})();
`;

export function rewriteHtml(html: string, baseUrl: string, prefix = "/api/proxy?url="): string {
  // Respect <base href> when present
  const baseMatch = html.match(/<base[^>]+href=(["'])([^"']+)\1/i);
  const effectiveBase = baseMatch ? absolutizeUrl(baseMatch[2], baseUrl) : baseUrl;

  // Rewrite common attributes
  html = html.replace(
    /(<[^>]+\s(?:href|src|action|poster|data|formaction)\s*=\s*)(["'])([^"']+)\2/gi,
    (m, pre, quote, url) => {
      const replaced = proxifyUrl(url, effectiveBase, prefix);
      return `${pre}${quote}${replaced}${quote}`;
    }
  );

  // Rewrite srcset values
  html = html.replace(
    /(<[^>]+\ssrcset\s*=\s*)(["'])([^"']+)\2/gi,
    (_m, pre, quote, val) => {
      const parts = val.split(",").map((p) => {
        const [u, d] = p.trim().split(/\s+/, 2);
        const proxied = proxifyUrl(u, effectiveBase, prefix);
        return d ? `${proxied} ${d}` : proxied;
      });
      return `${pre}${quote}${parts.join(", ")}${quote}`;
    }
  );

  // Inline style url() in style attrs
  html = html.replace(
    /style\s*=\s*(["'])([^"']+)\1/gi,
    (m, quote, val) => {
      const rewritten = rewriteCssUrls(val, effectiveBase, prefix);
      return `style=${quote}${rewritten}${quote}`;
    }
  );

  // Rewrite CSS inside <style> tags
  html = html.replace(/<style([^>]*)>([\s\S]*?)<\/style>/gi, (m, attrs, css) => {
    const rewritten = rewriteCssUrls(css, effectiveBase, prefix);
    return `<style${attrs}>${rewritten}</style>`;
  });

  // Handle meta refresh redirects
  html = html.replace(
    /<meta\s+http-equiv=(["'])refresh\1[^>]*content=(["'])(\s*\d+\s*;\s*url=)([^"']+)\2[^>]*>/gi,
    (m, _q1, q2, prefixPart, url) => {
      const proxied = proxifyUrl(url, effectiveBase, prefix);
      return m.replace(prefixPart + url, prefixPart + proxied);
    }
  );

  // Attempt to disable restrictive CSP meta
  html = html.replace(
    /<meta[^>]+http-equiv=["']?Content-Security-Policy["']?[^>]*>/gi,
    ""
  );

  // Inject shim right before </head> or at start of body
  const shim = `<script>(function(){window.__PROXY_PREFIX=${JSON.stringify(
    prefix
  )};window.__PROXY_ORIGIN=${JSON.stringify(effectiveBase)};${JS_MITIGATION}})();</script>`;

  if (html.match(/<\/head>/i)) {
    html = html.replace(/<\/head>/i, `${shim}</head>`);
  } else if (html.match(/<body[^>]*>/i)) {
    html = html.replace(/<body[^>]*>/i, (m) => `${m}${shim}`);
  } else {
    html = shim + html;
  }

  return html;
}

export function rewriteCss(css: string, baseUrl: string, prefix = "/api/proxy?url="): string {
  return rewriteCssUrls(css, baseUrl, prefix);
}

function rewriteCssUrls(input: string, baseUrl: string, prefix: string): string {
  return input.replace(/url\(([^)]+)\)/gi, (m, inner) => {
    let u = inner.trim().replace(/^['"]|['"]$/g, "");
    // ignore data: and about:
    if (/^(data:|about:|#)/i.test(u)) return m;
    const proxied = proxifyUrl(u, baseUrl, prefix);
    const quoted = /\s/.test(proxied) ? `'${proxied}'` : proxied;
    return `url(${quoted})`;
  });
}

export function rewriteLocationHeader(location: string, baseUrl: string, prefix = "/api/proxy?url="): string {
  try {
    const abs = absolutizeUrl(location, baseUrl);
    return sanitizeHeaderValue(`${prefix}${encodeURIComponent(abs)}`);
  } catch {
    return sanitizeHeaderValue(location);
  }
}

export function relaxCspHeader(value: string): string {
  // Remove frame-ancestors and upgrade-insecure-requests to avoid frame blocks
  const parts = value
    .split(";")
    .map((s) => s.trim())
    .filter((d) => d && !/^frame-ancestors\b/i.test(d) && !/^upgrade-insecure-requests\b/i.test(d));
  return parts.join("; ");
}