"use client";

import { useEffect, useRef, useState } from "react";
import { useSearchParams } from "next/navigation";

export default function ProxyPage() {
  const sp = useSearchParams();
  const initial = sp.get("u") || "";
  const [input, setInput] = useState(initial);
  const [target, setTarget] = useState<string | null>(initial || null);
  const iframeRef = useRef<HTMLIFrameElement>(null);

  useEffect(() => {
    if (!target || !iframeRef.current) return;
    const url = target.match(/^https?:\/\//) ? target : `https://${target}`;
    const proxyUrl = `/api/proxy?url=${encodeURIComponent(url)}`;
    iframeRef.current.src = proxyUrl;
  }, [target]);

  function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!input.trim()) return;
    setTarget(input.trim());
  }

  return (
    <div className="min-h-screen flex flex-col">
      <header className="p-3 border-b flex items-center gap-2">
        <form onSubmit={onSubmit} className="flex gap-2 w-full">
          <input
            className="flex-1 border rounded px-3 py-2 text-sm"
            placeholder="Enter a URL (e.g. https://example.com)"
            value={input}
            onChange={(e) => setInput(e.target.value)}
          />
          <button className="px-3 py-2 rounded bg-black text-white text-sm" type="submit">
            Go
          </button>
        </form>
      </header>
      <main className="flex-1">
        <iframe
          ref={iframeRef}
          className="w-full h-full"
          sandbox="allow-same-origin allow-scripts allow-forms allow-modals allow-pointer-lock allow-popups allow-popups-to-escape-sandbox allow-downloads"
        />
      </main>
    </div>
  );
}