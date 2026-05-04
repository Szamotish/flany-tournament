"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { authedFetch } from "@/lib/authClient";

export default function RulesTemplateEditor() {
  const [content, setContent] = useState("");
  const [msg, setMsg] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let cancelled = false;
    void authedFetch("/api/admin/rules-template", { cache: "no-store" })
      .then((res) => res.json().then((json) => ({ ok: res.ok, json })))
      .then(({ ok, json }) => {
        if (cancelled) return;
        if (ok) setContent(String(json.content ?? ""));
        else setMsg(`Blad: ${json.error ?? "rules_load_failed"}`);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  async function save() {
    setBusy(true);
    setMsg(null);
    const res = await authedFetch("/api/admin/rules-template", {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ content }),
    });
    const json = await res.json().catch(() => ({}));
    setBusy(false);
    if (!res.ok) {
      setMsg(`Blad zapisu: ${json.error ?? res.statusText}`);
      return;
    }
    setMsg("Domyslny szablon zasad zapisany.");
  }

  return (
    <main className="tour-root">
      <div className="tour-shell">
        <div className="tour-topbar">
          <Link className="underline opacity-80" href="/admin/tournaments">
            Back
          </Link>
          <span className="tour-kicker">Main admin</span>
        </div>

        <section className="tour-detail-main mt-4">
          <h1 className="tour-title">Domyslne zasady turniejow</h1>
          <p className="tour-muted mt-1">
            Ten tekst bedzie bazowym szablonem dla turniejow bez wlasnych zasad.
          </p>
        </section>

        <section className="tour-admin-panel mt-4">
          <textarea
            className="tour-admin-input tour-rules-textarea"
            value={content}
            onChange={(e) => setContent(e.target.value)}
            rows={14}
          />
          <div className="tour-admin-actions mt-3">
            <button className="tour-action-btn" type="button" onClick={() => void save()} disabled={busy}>
              {busy ? "Zapisywanie..." : "Zapisz zasady"}
            </button>
          </div>
          {msg ? <p className="tour-muted mt-2">{msg}</p> : null}
        </section>
      </div>
    </main>
  );
}
