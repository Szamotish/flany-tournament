"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { authedFetch } from "@/lib/authClient";

type RulesPayload = {
  content: string;
  source: "custom" | "default";
};

export default function RulesPageClient({ tournamentId }: { tournamentId: string }) {
  const [rules, setRules] = useState<RulesPayload | null>(null);
  const [isTournamentAdmin, setIsTournamentAdmin] = useState(false);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState("");
  const [msg, setMsg] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    const [rulesRes, membershipRes] = await Promise.all([
      fetch(`/api/public/tournaments/${tournamentId}/rules`, { cache: "no-store" }),
      authedFetch(`/api/public/tournaments/${tournamentId}/membership`, { cache: "no-store" }),
    ]);
    const rulesJson = await rulesRes.json().catch(() => ({}));
    const membershipJson = await membershipRes.json().catch(() => ({}));
    if (rulesRes.ok) {
      const next = {
        content: String(rulesJson.content ?? ""),
        source: rulesJson.source === "custom" ? "custom" : "default",
      } as RulesPayload;
      setRules(next);
      setDraft(next.content);
    }
    setIsTournamentAdmin(membershipRes.ok && membershipJson.isTournamentAdmin === true);
  }, [tournamentId]);

  useEffect(() => {
    let cancelled = false;
    async function run() {
      if (cancelled) return;
      await load();
    }
    void run();
    return () => {
      cancelled = true;
    };
  }, [load]);

  async function save() {
    setBusy(true);
    setMsg(null);
    const res = await authedFetch(`/api/admin/tournaments/${tournamentId}/rules`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ content: draft }),
    });
    const json = await res.json().catch(() => ({}));
    setBusy(false);
    if (!res.ok) {
      setMsg(`Blad zapisu: ${json.error ?? res.statusText}`);
      return;
    }
    setEditing(false);
    setMsg("Zasady zapisane.");
    await load();
  }

  return (
    <main className="tour-root">
      <div className="tour-shell">
        <div className="tour-topbar">
          <Link className="underline opacity-80" href={`/tournaments/${tournamentId}`}>
            Back
          </Link>
          <span className="tour-kicker">Zasady turnieju</span>
        </div>

        <section className="tour-rules-stage mt-4">
          {editing ? (
            <div className="tour-admin-panel">
              <h1 className="tour-title">Edytuj zasady</h1>
              <p className="tour-muted mt-1">
                Ten tekst bedzie pokazany graczom na pergaminie zasad turnieju.
              </p>
              <textarea
                className="tour-admin-input tour-rules-textarea mt-4"
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                rows={14}
              />
              <div className="tour-admin-actions mt-3">
                <button className="tour-action-btn" type="button" onClick={() => void save()} disabled={busy}>
                  {busy ? "Zapisywanie..." : "Zapisz"}
                </button>
                <button className="tour-action-btn" type="button" onClick={() => setEditing(false)} disabled={busy}>
                  Anuluj
                </button>
              </div>
            </div>
          ) : (
            <>
              <div className="tour-rules-scroll" aria-label="Zasady turnieju">
                <div className="tour-rules-scroll-content">
                  <h1>Zasady</h1>
                  <pre className="tour-rules-pre">{rules?.content ?? "Ladowanie zasad..."}</pre>
                </div>
              </div>
              {isTournamentAdmin ? (
                <div className="tour-admin-actions tour-rules-actions">
                  <button className="tour-action-btn" type="button" onClick={() => setEditing(true)}>
                    Edytuj zasady
                  </button>
                </div>
              ) : null}
            </>
          )}
          {msg ? <p className="tour-muted mt-2">{msg}</p> : null}
        </section>
      </div>
    </main>
  );
}
