"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { authedFetch } from "@/lib/authClient";
import { newNotebook, parseNotebook, type Notebook, type NotebookPlayer } from "@/lib/notebook";

export function notebookMessage(code: string) {
  const messages: Record<string, string> = {
    missing_notebook_schema: "Notatnik wymaga uruchomienia migracji 20261017_match_notebooks.sql w Supabase.",
    ranked_only: "Notatnik statystyk jest dostępny dla turniejów rankingowych.",
    forbidden_tournament_admin_only: "Notatnik jest dostępny tylko dla administratorów tego turnieju.",
    missing_bearer_token: "Zaloguj się jako administrator turnieju.",
    invalid_or_expired_token: "Sesja wygasła. Zaloguj się ponownie; kopia robocza pozostaje na tym urządzeniu.",
    roster_changed: "Skład drużyn zmienił się od zapisania notatnika. Zachowano poprzednie wpisy; nie można przypisać ich do nowego składu.",
    revision_conflict: "Inny administrator lub karta przeglądarki zapisała nowszą wersję. Twoja kopia pozostaje na urządzeniu. Pobierz kopię, zanim wczytasz zapis z serwera.",
    invalid_notebook: "Wpisy wymagają sprawdzenia. Nie zapisano niepoprawnych danych.",
    local_draft_invalid: "Kopia robocza nie pasuje do obecnego składu lub formatu. Pobierz ją przed wczytaniem zapisu z serwera.",
  };
  return messages[code] ?? "Nie udało się połączyć z notatnikiem. Spróbuj ponownie.";
}

type Draft = { document: Notebook; revision: number; dirty: boolean };
type State = Draft & { status: string; blocked: boolean };

export default function useNotebook(tournamentId: string, matchId: string, game: number, viewerId: string, roster: NotebookPlayer[]) {
  const endpoint = `/api/admin/tournaments/${tournamentId}/notebook`;
  const key = `flanki-notebook:v1:${viewerId}:${tournamentId}:${matchId}:${game}`;
  const [state, setState] = useState<State | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [localWarning, setLocalWarning] = useState(false);
  const current = useRef<State | null>(null);
  const saving = useRef(false);
  const alive = useRef(true);
  const loadVersion = useRef(0);

  const commit = useCallback((next: State) => {
    current.current = next;
    try {
      localStorage.setItem(key, JSON.stringify({ document: next.document, revision: next.revision, dirty: next.dirty }));
      setLocalWarning(false);
    } catch { setLocalWarning(true); }
    setState(next);
  }, [key]);

  const load = useCallback(async (discardLocal = false) => {
    const version = ++loadVersion.current;
    setError(null);
    try {
      const res = await authedFetch(`${endpoint}?matchId=${matchId}&game=${game}`, { cache: "no-store" });
      const data = await res.json();
      if (!alive.current || version !== loadVersion.current) return;
      if (!res.ok) { setError(notebookMessage(data.error)); return; }
      const server = data.document ? parseNotebook(data.document, roster) : newNotebook(roster);
      if (!server) { setError(notebookMessage("invalid_notebook")); return; }
      let draft: Draft | null = null;
      if (!discardLocal) {
        let raw: string | null = null;
        try { raw = localStorage.getItem(key); } catch { setLocalWarning(true); }
        if (raw) {
          try {
            const stored = JSON.parse(raw);
            if (stored.dirty === true) {
              const document = parseNotebook(stored.document, roster);
              if (!document || !Number.isInteger(stored.revision) || stored.revision < 0) throw new Error("invalid");
              draft = { document, revision: stored.revision, dirty: true };
            }
          } catch { setError(notebookMessage("local_draft_invalid")); return; }
        }
      }
      if (draft && JSON.stringify(draft.document) === JSON.stringify(server)) draft = null;
      const conflict = draft !== null && draft.revision !== data.revision;
      commit({ ...(draft ?? { document: server, revision: data.revision, dirty: false }), blocked: conflict,
        status: conflict ? notebookMessage("revision_conflict") : draft ? "Przywrócono kopię z urządzenia. Oczekuje na zapis." : "Zapisane" });
    } catch { if (alive.current && version === loadVersion.current) setError(notebookMessage("network")); }
  }, [endpoint, matchId, game, key, roster, commit]);

  useEffect(() => {
    alive.current = true;
    void load();
    return () => { alive.current = false; };
  }, [load]);

  const save = useCallback(async () => {
    const snapshot = current.current;
    if (!snapshot || !snapshot.dirty || snapshot.blocked || saving.current) return;
    saving.current = true;
    setState(s => s ? { ...s, status: "Zapisywanie…" } : s);
    try {
      const res = await authedFetch(endpoint, { method: "PUT", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ matchId, game, revision: snapshot.revision, document: snapshot.document }), signal: AbortSignal.timeout(12_000) });
      const data = await res.json();
      if (!alive.current || !current.current) return;
      if (!res.ok) {
        const blocked = [400, 401, 403, 404, 409, 413].includes(res.status);
        commit({ ...current.current, blocked, status: blocked ? notebookMessage(data.error) : "Brak zapisu na serwerze. Ponowię próbę; kopia pozostaje na urządzeniu." });
        return;
      }
      const dirty = current.current.document !== snapshot.document;
      commit({ ...current.current, revision: data.revision, dirty, status: dirty ? "Oczekuje na zapis" : "Zapisane" });
    } catch {
      if (alive.current && current.current) commit({ ...current.current, status: "Brak połączenia. Kopia na urządzeniu czeka na wysłanie." });
    } finally { saving.current = false; }
  }, [endpoint, matchId, game, commit]);

  useEffect(() => {
    if (!state?.dirty || state.blocked) return;
    const timeout = setTimeout(() => void save(), 800);
    const interval = setInterval(() => void save(), 15_000);
    const online = () => void save();
    const unload = (e: BeforeUnloadEvent) => { if (current.current?.dirty) e.preventDefault(); };
    window.addEventListener("online", online);
    window.addEventListener("beforeunload", unload);
    return () => { clearTimeout(timeout); clearInterval(interval); window.removeEventListener("online", online); window.removeEventListener("beforeunload", unload); };
  }, [state?.dirty, state?.blocked, state?.document, state?.revision, save]);

  function update(document: Notebook) {
    if (!current.current || current.current.blocked) return;
    commit({ ...current.current, document, dirty: true, status: "Oczekuje na zapis" });
  }
  function download() {
    let text = state ? JSON.stringify(state) : null;
    try { text = localStorage.getItem(key) ?? text; } catch { /* The in-memory draft is still exportable. */ }
    if (!text) return;
    const url = URL.createObjectURL(new Blob([text], { type: "application/json" }));
    const link = document.createElement("a");
    link.href = url; link.download = `notatnik-${matchId}-gra-${game}.json`; link.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
  return { state, error, localWarning, update, save, load, download };
}
