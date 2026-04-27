"use client";

import Link from "next/link";
import { Suspense, useMemo, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { getSupabaseBrowserClient } from "@/lib/supabaseBrowser";

type Mode = "login" | "signup";

function mapAuthError(error: string): string {
  if (error.includes("Invalid login credentials")) return "Niepoprawny email lub haslo.";
  if (error.includes("Email not confirmed")) return "Potwierdz email i sproboj ponownie.";
  if (error.includes("User already registered")) return "Konto z tym emailem juz istnieje.";
  if (error.includes("Password should be at least")) return "Haslo jest za krotkie.";
  return error;
}

function AuthPageInner() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const redirectTo = useMemo(() => searchParams.get("next") || "/", [searchParams]);

  const [mode, setMode] = useState<Mode>("login");
  const [pseudonym, setPseudonym] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  async function doLogin() {
    setMsg(null);
    setBusy(true);
    const supabase = getSupabaseBrowserClient();

    const { error } = await supabase.auth.signInWithPassword({
      email: email.trim().toLowerCase(),
      password,
    });

    setBusy(false);
    if (error) {
      setMsg(mapAuthError(error.message));
      return;
    }

    router.push(redirectTo);
    router.refresh();
  }

  async function doSignup() {
    setMsg(null);
    setBusy(true);

    const signupRes = await fetch("/api/auth/signup", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        pseudonym,
        email: email.trim().toLowerCase(),
        password,
      }),
    });

    const signupJson = await signupRes.json().catch(() => ({}));
    if (!signupRes.ok) {
      setBusy(false);
      if (signupJson.error === "pseudonym_taken") {
        setMsg("Ten pseudonim jest juz zajety.");
      } else if (signupJson.error === "invalid_pseudonym") {
        setMsg("Pseudonim musi miec min. 2 znaki.");
      } else if (signupJson.error === "password_too_short") {
        setMsg("Haslo musi miec min. 8 znakow.");
      } else {
        setMsg(`Blad rejestracji: ${signupJson.error ?? signupRes.statusText}`);
      }
      return;
    }

    if (signupJson.requiresEmailConfirmation) {
      setBusy(false);
      setMsg("Konto utworzone. Potwierdz email, potem sie zaloguj.");
      setMode("login");
      return;
    }

    const supabase = getSupabaseBrowserClient();
    const { error } = await supabase.auth.signInWithPassword({
      email: email.trim().toLowerCase(),
      password,
    });

    setBusy(false);
    if (error) {
      setMsg(`Konto utworzone, ale logowanie nieudane: ${mapAuthError(error.message)}`);
      setMode("login");
      return;
    }

    router.push(redirectTo);
    router.refresh();
  }

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (mode === "login") {
      await doLogin();
      return;
    }
    await doSignup();
  }

  return (
    <main className="mx-auto max-w-md p-4 md:p-6">
      <Link className="underline opacity-80" href="/">
        Back
      </Link>

      <section className="mt-4 rounded-2xl border border-black/15 bg-white/70 p-4 shadow-[0_12px_28px_rgba(0,0,0,0.12)] backdrop-blur">
        <h1 className="text-2xl font-semibold">{mode === "login" ? "Logowanie" : "Rejestracja"}</h1>
        <p className="mt-1 text-sm opacity-80">
          {mode === "login"
            ? "Zaloguj sie, aby oceniac graczy i korzystac z paneli admina."
            : "Utworz konto gracza: pseudonim + email + haslo."}
        </p>

        <form className="mt-4 space-y-3" onSubmit={onSubmit}>
          {mode === "signup" ? (
            <div>
              <label className="block text-sm font-medium">Pseudonim</label>
              <input
                className="mt-1 w-full rounded-lg border border-black/25 bg-white/90 px-3 py-2"
                value={pseudonym}
                onChange={(e) => setPseudonym(e.target.value)}
                maxLength={40}
                required
              />
            </div>
          ) : null}

          <div>
            <label className="block text-sm font-medium">Email</label>
            <input
              className="mt-1 w-full rounded-lg border border-black/25 bg-white/90 px-3 py-2"
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
            />
          </div>

          <div>
            <label className="block text-sm font-medium">Haslo</label>
            <input
              className="mt-1 w-full rounded-lg border border-black/25 bg-white/90 px-3 py-2"
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              minLength={8}
              required
            />
          </div>

          <button
            className="rounded-xl border border-black/30 bg-black/90 px-4 py-2 font-semibold text-white disabled:opacity-60"
            type="submit"
            disabled={busy}
          >
            {busy ? "Prosze czekac..." : mode === "login" ? "Zaloguj" : "Utworz konto"}
          </button>
        </form>

        <div className="mt-4 text-sm">
          {mode === "login" ? (
            <button className="underline opacity-90" type="button" onClick={() => setMode("signup")}>
              Nie masz konta? Zarejestruj sie
            </button>
          ) : (
            <button className="underline opacity-90" type="button" onClick={() => setMode("login")}>
              Masz juz konto? Zaloguj sie
            </button>
          )}
        </div>

        {msg ? <p className="mt-3 text-sm text-amber-900">{msg}</p> : null}
      </section>
    </main>
  );
}

function AuthPageFallback() {
  return (
    <main className="mx-auto max-w-md p-4 md:p-6">
      <Link className="underline opacity-80" href="/">
        Back
      </Link>
      <section className="mt-4 rounded-2xl border border-black/15 bg-white/70 p-4 shadow-[0_12px_28px_rgba(0,0,0,0.12)] backdrop-blur">
        <p className="text-sm opacity-80">Ladowanie formularza logowania...</p>
      </section>
    </main>
  );
}

export default function AuthPage() {
  return (
    <Suspense fallback={<AuthPageFallback />}>
      <AuthPageInner />
    </Suspense>
  );
}
