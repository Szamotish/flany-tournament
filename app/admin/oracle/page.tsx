"use client";

import { useEffect, useState } from "react";
import BackNavButton from "@/app/components/BackNavButton";
import { useOracle } from "@/app/components/useOracle";
import { authedFetch } from "@/lib/authClient";
import { ORACLE_MODELS, ORACLE_QUESTION_LENGTH, oracleStatusText, type OracleMode, type OracleModel } from "@/lib/oracleConfig";

type Config = { configured: boolean; mode: OracleMode; model: OracleModel; blockedUntil: string | null };
export default function OracleAdminPage() {
  const oracle = useOracle();
  const [config, setConfig] = useState<Config | null>(null);
  const [mode, setMode] = useState<OracleMode>("off");
  const [model, setModel] = useState<OracleModel>(ORACLE_MODELS[0]);
  const [question, setQuestion] = useState("");
  const [message, setMessage] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  useEffect(() => {
    let cancelled = false;
    void authedFetch("/api/admin/oracle", { cache: "no-store", signal: AbortSignal.timeout(8000) })
      .then(async (response) => {
        const data = await response.json();
        if (cancelled) return;
        if (!response.ok) { setMessage(data.error ?? "Nie udało się wczytać ustawień."); return; }
        setConfig(data); setMode(data.mode); setModel(data.model);
      }).catch(() => { if (!cancelled) setMessage("Nie udało się wczytać ustawień."); });
    return () => { cancelled = true; };
  }, []);

  async function save(nextMode = mode) {
    setSaving(true); setMessage(null);
    try {
      const response = await authedFetch("/api/admin/oracle", {
        method: "PATCH", headers: { "content-type": "application/json" },
        body: JSON.stringify({ mode: nextMode, model }), signal: AbortSignal.timeout(8000),
      });
      const data = await response.json();
      if (!response.ok) { setMessage(data.error ?? "Błąd zapisu."); return; }
      setConfig(data); setMode(data.mode); setMessage("Ustawienia zapisane.");
      window.dispatchEvent(new Event("oracle-settings-changed"));
    } catch { setMessage("Nie udało się zapisać ustawień."); }
    finally { setSaving(false); }
  }

  return <main className="tour-root"><div className="tour-shell">
    <div className="tour-topbar"><BackNavButton fallbackHref="/" /></div>
    <section className="tour-detail-main mt-4">
      <h1 className="tour-title">Test kuli</h1>
      {message ? <p role="status">{message}</p> : null}
      {!config && !message ? <p>Wczytywanie…</p> : null}
      {config ? <div className="oracle-admin-form">
        {!config.configured ? <p role="status">Kula jest wyłączona na serwerze. Skonfiguruj Groq Free i zmienne Vercela zgodnie z instrukcją w docs/oracle-ai.md.</p> : null}
        <label>Dostępność
          <select className="tour-admin-input" value={mode} onChange={(event) => setMode(event.target.value as OracleMode)} disabled={saving}>
            <option value="off">Wyłączona</option><option value="admin">Tylko main admin</option>
            <option value="public">Zalogowani, aktywni gracze</option>
          </select>
        </label>
        <label>Model do testu i do zapisania jako domyślny
          <select className="tour-admin-input" value={model} onChange={(event) => setModel(event.target.value as OracleModel)} disabled={saving || oracle.busy}>
            {ORACLE_MODELS.map((value) => <option key={value} value={value}>{value}{value.startsWith("qwen") ? " (preview)" : ""}</option>)}
          </select>
        </label>
        <div className="tour-admin-actions">
          <button className="tour-action-btn" disabled={saving} onClick={() => void save()}>Zapisz ustawienia</button>
          <button className="tour-action-btn" disabled={saving} onClick={() => void save("off")}>Wyłącz kulę</button>
        </div>
        <p className="tour-muted">Limit: 100 pytań wspólnie i 10 na osobę w ostatnich 24 godzinach. Testy też się liczą. Obowiązuje dodatkowy budżet tokenów; zmiana modelu nie zeruje limitów.</p>
        <p role="status">{oracleStatusText(oracle.status)}</p>
        {oracle.status?.remainingGlobal !== undefined ? <p>Pozostało pytań: {oracle.status.remainingGlobal} wspólnie / {oracle.status.remainingUser} dla Ciebie.</p> : null}
        <label>Pytanie
          <input className="tour-admin-input" value={question} maxLength={ORACLE_QUESTION_LENGTH}
            onChange={(event) => setQuestion(event.target.value)} disabled={oracle.busy}
            onKeyDown={(event) => { if (event.key === "Enter") void oracle.ask(question, model); }} />
        </label>
        <div className="tour-admin-actions">
          <button className="tour-action-btn" disabled={oracle.busy || !oracle.status?.available || !question.trim()} onClick={() => void oracle.ask(question, model)}>
            {oracle.busy ? "Kula odpowiada…" : "Zapytaj wybrany model"}
          </button>
          <button className="tour-action-btn" onClick={() => void oracle.refresh()}>Odśwież dostępność</button>
        </div>
        {oracle.answer ? <p className="oracle-admin-answer" aria-live="polite">{oracle.answer}</p> : null}
        {oracle.error ? <p role="alert">{oracle.error}</p> : null}
      </div> : null}
    </section>
  </div></main>;
}
