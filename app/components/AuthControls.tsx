"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { authedFetch } from "@/lib/authClient";
import { getSupabaseBrowserClient } from "@/lib/supabaseBrowser";

type AuthState = {
  loading: boolean;
  authenticated: boolean;
  playerName: string | null;
  isMainAdmin: boolean;
};

async function readAuthState(): Promise<AuthState> {
  const res = await authedFetch("/api/auth/me", { cache: "no-store" });
  const json = await res.json().catch(() => ({}));

  return {
    loading: false,
    authenticated: Boolean(json.authenticated),
    playerName: typeof json.player?.name === "string" ? json.player.name : null,
    isMainAdmin: json.isMainAdmin === true,
  };
}

export default function AuthControls() {
  const [auth, setAuth] = useState<AuthState>({
    loading: true,
    authenticated: false,
    playerName: null,
    isMainAdmin: false,
  });

  useEffect(() => {
    let mounted = true;
    const supabase = getSupabaseBrowserClient();

    void readAuthState().then((state) => {
      if (!mounted) return;
      setAuth(state);
    });

    const { data: listener } = supabase.auth.onAuthStateChange(() => {
      void readAuthState().then((state) => {
        if (!mounted) return;
        setAuth(state);
      });
    });

    return () => {
      mounted = false;
      listener.subscription.unsubscribe();
    };
  }, []);

  async function logout() {
    const supabase = getSupabaseBrowserClient();
    await supabase.auth.signOut();
    setAuth({
      loading: false,
      authenticated: false,
      playerName: null,
      isMainAdmin: false,
    });
    window.location.href = "/";
  }

  return (
    <div className="auth-controls">
      {auth.loading ? (
        <span className="auth-chip">...</span>
      ) : auth.authenticated ? (
        <>
          <Link href="/players" className="auth-chip">
            {auth.playerName ?? "Konto"}
          </Link>
          {auth.isMainAdmin ? (
            <Link href="/admin/tournaments" className="auth-chip auth-chip-admin">
              Main admin
            </Link>
          ) : null}
          <button className="auth-chip auth-chip-logout" type="button" onClick={logout}>
            Wyloguj
          </button>
        </>
      ) : (
        <Link href="/auth" className="auth-chip auth-chip-login">
          Logowanie
        </Link>
      )}
    </div>
  );
}
