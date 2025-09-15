"use client";

import Link from "next/link";
import { useState } from "react";

export default function Home() {
  const [u, setU] = useState("https://example.com");
  const proxyHref = `/api/proxy?url=${encodeURIComponent(u)}`;
  return (
    <div className="min-h-screen p-6 flex flex-col items-center gap-6">
      <h1 className="text-2xl font-semibold">Serverless Web Proxy</h1>
      <p className="text-sm text-neutral-600">Enter a URL to browse via the built-in proxy. This runs entirely on serverless functions.</p>
      <div className="flex gap-2 w-full max-w-3xl">
        <input
          className="flex-1 border rounded px-3 py-2 text-sm"
          value={u}
          onChange={(e) => setU(e.target.value)}
          placeholder="https://example.com"
        />
        <Link href={`/api/proxy?url=${encodeURIComponent(u)}`} className="px-3 py-2 rounded bg-black text-white text-sm flex items-center">Open</Link>
        <Link href={`/proxy?u=${encodeURIComponent(u)}`} className="px-3 py-2 rounded border text-sm flex items-center">Open in UI</Link>
      </div>
      <div className="text-xs text-neutral-500">
        Tip: Use the Proxy UI for an embedded experience or the direct link to navigate the full page.
      </div>
    </div>
  );
}
