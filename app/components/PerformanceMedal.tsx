"use client";

import { useEffect, useState } from "react";

export default function PerformanceMedal({ expiresAt }: { expiresAt: string }) {
  const [expired, setExpired] = useState(false);
  useEffect(() => {
    const remaining = Math.max(0, Date.parse(expiresAt) - Date.now());
    const timer = window.setTimeout(() => setExpired(true), remaining);
    return () => window.clearTimeout(timer);
  }, [expiresAt]);
  if (expired) return null;
  const until = new Date(expiresAt).toLocaleString("pl-PL", { timeZone: "Europe/Warsaw" });
  const label = `Performance bonus — wyróżnienie za świetną grę. Medal do ${until}. Przyznane punkty pozostają w rankingu.`;
  return (
    <span className="performance-medal" title={label} role="img" aria-label={label}>
      <svg viewBox="0 0 48 72" aria-hidden="true">
        <path d="M10 4H38V28L24 38 10 28Z" fill="#c63420" stroke="#a56a12" strokeWidth="2" />
        <path d="M14 7H21V29L14 24Z" fill="#fa5d37" />
        <path d="M29 7H34V25L29 29Z" fill="#991e15" />
        <path d="M8 4H40M8 29H40" stroke="#ffe092" strokeWidth="3" strokeLinecap="round" />
        <path d="M22 33H26V44H22Z" fill="#ffe092" stroke="#c88b20" />
        <path d="M24 40 30 49 41 51 33 59 34 70 24 65 14 70 15 59 7 51 18 49Z" fill="#ffc53b" stroke="#c89019" strokeWidth="1.5" strokeLinejoin="round" />
        <path d="M24 43V57L10 52 20 51Z" fill="#fff0a0" />
        <path d="M24 57 32 67 31 58 38 52Z" fill="#e79b19" />
        <path d="M24 57 16 67 24 63Z" fill="#ffe483" />
      </svg>
    </span>
  );
}
