"use client";

import { useEffect, useState } from "react";
import BackNavButton from "@/app/components/BackNavButton";
import { useOracle } from "@/app/components/useOracle";
import { authedFetch } from "@/lib/authClient";
import { ORACLE_MODELS, oracleStatusText, type OracleMode, type OracleModel, type OracleConfigurationIssue } from "@/lib/oracleConfig";

type Config = { configured: boolean; configurationIssues?: OracleConfigurationIssue[]; mode: OracleMode; model: OracleModel; blockedUntil: string | null };
export default function OracleAdminPage() {
  const oracle = useOracle();
  const [config, setConfig] = useState<Config | null>(null);
  const [mode, setMode] = useState<OracleMode>("off");
  const [model, setModel] = useState<OracleModel>(ORACLE_MODELS[0]);
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
      <h1 className="tour-title">Ustawienia kuli</h1>
      {message ? <p role="status">{message}</p> : null}
      {!config && !message ? <p>Wczytywanie…</p> : null}
      {config ? <div className="oracle-admin-form">
        {!config.configured ? <div role="status">
          <p>Tryb kuli można zapisać, ale to wdrożenie nie ma kompletnej konfiguracji serwera:</p>
          {config.configurationIssues?.length ? <ul className="list-disc pl-5 mt-2">
            {config.configurationIssues.map((issue) => <li key={issue.variable}>
              <code>{issue.variable}</code>: {issue.reason === "missing" ? "brak zmiennej lub pusta wartość." : "wartość musi wynosić dokładnie true (bez cudzysłowów)."}
            </li>)}
          </ul> : <p>Sprawdź GROQ_API_KEY, ORACLE_ENABLED i ORACLE_FREE_PLAN_CONFIRMED.</p>}
          <p className="mt-2">Popraw zmienne w Vercelu dla Production, wykonaj Redeploy i odśwież tę stronę. Klucza API nie wklejaj na czat.</p>
        </div> : null}
        <label>Dostępność
          <select className="tour-admin-input" value={mode} onChange={(event) => setMode(event.target.value as OracleMode)} disabled={saving}>
            <option value="off">Wyłączona</option><option value="admin">Tylko main admin</option>
            <option value="public">Zalogowani, aktywni gracze</option>
          </select>
        </label>
        <label>Model kuli
          <select className="tour-admin-input" value={model} onChange={(event) => setModel(event.target.value as OracleModel)} disabled={saving}>
            {ORACLE_MODELS.map((value) => <option key={value} value={value}>{value}{value.startsWith("qwen") ? " (preview)" : ""}</option>)}
          </select>
        </label>
        <div className="tour-admin-actions">
          <button className="tour-action-btn" disabled={saving} onClick={() => void save()}>Zapisz ustawienia</button>
          <button className="tour-action-btn" disabled={saving} onClick={() => void save("off")}>Wyłącz kulę</button>
        </div>
        <p className="tour-muted">Kula otwiera się przyciskiem w prawym górnym rogu kafelka Flanki League na stronie głównej. Aby udostępnić ją graczom, wybierz „Zalogowani, aktywni gracze” i zapisz ustawienia.</p>
        <p className="tour-muted">Limit: 100 pytań wspólnie i 10 na osobę w ostatnich 24 godzinach. Obowiązuje dodatkowy budżet tokenów; zmiana modelu nie zeruje limitów.</p>
        {config.configured ? <p role="status">{oracleStatusText(oracle.status)}</p> : null}
        {oracle.status?.remainingGlobal !== undefined ? <p>Pozostało pytań: {oracle.status.remainingGlobal} wspólnie / {oracle.status.remainingUser} dla Ciebie.</p> : null}
        <div className="tour-admin-actions">
          <button className="tour-action-btn" onClick={() => void oracle.refresh()}>Odśwież dostępność</button>
        </div>
      </div> : null}
    </section>
  </div></main>;
}
