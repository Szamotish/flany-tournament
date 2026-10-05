"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { authedFetch } from "@/lib/authClient";
import { getSupabaseBrowserClient } from "@/lib/supabaseBrowser";
import type { OracleModel, OracleStatus } from "@/lib/oracleConfig";

const unavailable: OracleStatus = { available: false, reason: "unavailable" };
function readStatus(value: unknown): OracleStatus {
  if (!value || typeof value !== "object" || typeof (value as OracleStatus).available !== "boolean"
    || typeof (value as OracleStatus).reason !== "string") return unavailable;
  return value as OracleStatus;
}

export function useOracle() {
  const [status, setStatus] = useState<OracleStatus | null>(null);
  const [answer, setAnswer] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const inFlight = useRef(false);
  const statusVersion = useRef(0);
  const mounted = useRef(false);
  const sessionUser = useRef<string | null>(null);
  const invalidateStatus = useCallback(() => { ++statusVersion.current; }, []);
  const refresh = useCallback(async () => {
    const version = ++statusVersion.current;
    let next = unavailable;
    try {
      const response = await authedFetch("/api/oracle", { cache: "no-store", signal: AbortSignal.timeout(8000) });
      if (response.ok) next = readStatus(await response.json());
    } catch { /* Network/configuration failures hide the entry point. */ }
    if (mounted.current && version === statusVersion.current) setStatus(next);
  }, []);

  useEffect(() => {
    mounted.current = true;
    const supabase = getSupabaseBrowserClient();
    let channel: ReturnType<typeof supabase.channel> | null = null;
    let debounce: ReturnType<typeof setTimeout> | undefined;
    let userId: string | null = null;
    const visibleRefresh = () => { if (document.visibilityState === "visible") void refresh(); };
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      const nextId = session?.user.id ?? null;
      if (sessionUser.current !== nextId) { ++statusVersion.current; sessionUser.current = nextId; }
      // Schedule outside Supabase's auth callback to avoid getSession deadlocks.
      clearTimeout(debounce);
      debounce = setTimeout(() => {
        if (!mounted.current) return;
        if (nextId !== userId) { setAnswer(null); setError(null); }
        userId = nextId;
        if (channel) { void supabase.removeChannel(channel); channel = null; }
        if (session) {
          channel = supabase.channel(`oracle-availability-${crypto.randomUUID()}`)
            .on("postgres_changes", { event: "UPDATE", schema: "public", table: "oracle_availability" }, visibleRefresh)
            .subscribe();
          void refresh();
        } else { ++statusVersion.current; setStatus({ available: false, reason: "disabled" }); }
      }, 0);
    });
    // Realtime is best effort; one status check/minute while visible is the fallback.
    const interval = setInterval(() => { if (userId) visibleRefresh(); }, 60000);
    document.addEventListener("visibilitychange", visibleRefresh);
    window.addEventListener("focus", visibleRefresh);
    window.addEventListener("oracle-settings-changed", visibleRefresh);
    return () => {
      mounted.current = false; invalidateStatus();
      clearTimeout(debounce); clearInterval(interval); subscription.unsubscribe();
      if (channel) void supabase.removeChannel(channel);
      document.removeEventListener("visibilitychange", visibleRefresh);
      window.removeEventListener("focus", visibleRefresh);
      window.removeEventListener("oracle-settings-changed", visibleRefresh);
    };
  }, [refresh, invalidateStatus]);

  useEffect(() => {
    if (!status?.retryAt) return;
    const remaining = new Date(status.retryAt).getTime() - Date.now();
    if (!Number.isFinite(remaining)) return;
    const timeout = setTimeout(() => {
      if (document.visibilityState === "visible") void refresh();
    }, Math.min(2147483647, Math.max(1000, remaining + 500)));
    return () => clearTimeout(timeout);
  }, [status, refresh]);

  async function ask(question: string, model?: OracleModel) {
    if (inFlight.current || !status?.available || !question.trim()) return;
    inFlight.current = true;
    const askingUser = sessionUser.current;
    ++statusVersion.current;
    setBusy(true); setError(null); setAnswer(null);
    try {
      const response = await authedFetch("/api/oracle", {
        method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({ question: question.trim(), requestId: crypto.randomUUID(), ...(model ? { model } : {}) }),
        signal: AbortSignal.timeout(25000),
      });
      const json = await response.json();
      if (!mounted.current || askingUser !== sessionUser.current) return;
      ++statusVersion.current;
      setStatus(readStatus(json.status));
      if (response.ok && typeof json.answer === "string") setAnswer(json.answer);
      else setError(json.error ?? "Kula jest teraz niedostępna.");
    } catch {
      if (mounted.current && askingUser === sessionUser.current) { setStatus(unavailable); setError("Nie udało się odebrać odpowiedzi kuli."); }
    } finally {
      inFlight.current = false;
      if (mounted.current) setBusy(false);
    }
  }
  return { status, answer, error, busy, ask, refresh, clearAnswer: () => { setAnswer(null); setError(null); } };
}
