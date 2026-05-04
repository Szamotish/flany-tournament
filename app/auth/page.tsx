"use client";

import Link from "next/link";
import Script from "next/script";
import { Suspense, useEffect, useMemo, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { getSupabaseBrowserClient } from "@/lib/supabaseBrowser";

type Mode = "login" | "signup" | "forgot";

type TurnstileApi = {
  render: (
    container: HTMLElement,
    options: {
      sitekey: string;
      callback: (token: string) => void;
      "expired-callback": () => void;
      "error-callback": () => void;
    }
  ) => string;
  remove?: (widgetId: string) => void;
  reset?: (widgetId: string) => void;
};

declare global {
  interface Window {
    turnstile?: TurnstileApi;
  }
}

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
  const confirmed = searchParams.get("confirmed") === "1";
  const passwordReset = searchParams.get("reset") === "done";
  const turnstileSiteKey = process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY;

  const [mode, setMode] = useState<Mode>("login");
  const [pseudonym, setPseudonym] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [turnstileReady, setTurnstileReady] = useState(false);
  const turnstileContainerRef = useRef<HTMLDivElement | null>(null);
  const turnstileWidgetIdRef = useRef<string | null>(null);
  const turnstileTokenRef = useRef("");

  useEffect(() => {
    if (!confirmed && !passwordReset) return;

    let cancelled = false;
    const supabase = getSupabaseBrowserClient();

    (async () => {
      const { data } = await supabase.auth.getSession();
      if (cancelled) return;

      if (confirmed && data.session) {
        router.replace(redirectTo);
        router.refresh();
        return;
      }

      setMsg(passwordReset ? "Haslo zmienione. Mozesz sie teraz zalogowac." : "Email potwierdzony. Mozesz sie teraz zalogowac.");
      setMode("login");
    })();

    return () => {
      cancelled = true;
    };
  }, [confirmed, passwordReset, redirectTo, router]);

  useEffect(() => {
    if (!turnstileSiteKey || mode !== "signup") {
      turnstileTokenRef.current = "";
      return;
    }

    const api = window.turnstile;
    const container = turnstileContainerRef.current;
    if (!api || !container) return;

    if (turnstileWidgetIdRef.current && api.remove) {
      api.remove(turnstileWidgetIdRef.current);
      turnstileWidgetIdRef.current = null;
    }

    container.innerHTML = "";
    turnstileTokenRef.current = "";
    turnstileWidgetIdRef.current = api.render(container, {
      sitekey: turnstileSiteKey,
      callback: (token) => {
        turnstileTokenRef.current = token;
        setMsg((current) =>
          current === "Potwierdz zabezpieczenie antybotowe i sproboj ponownie." ? null : current
        );
      },
      "expired-callback": () => {
        turnstileTokenRef.current = "";
      },
      "error-callback": () => {
        turnstileTokenRef.current = "";
        setMsg("Nie udalo sie zaladowac zabezpieczenia antybotowego. Odswiez strone i sproboj ponownie.");
      },
    });

    return () => {
      const widgetId = turnstileWidgetIdRef.current;
      if (widgetId && window.turnstile?.remove) {
        window.turnstile.remove(widgetId);
      }
      if (turnstileWidgetIdRef.current === widgetId) {
        turnstileWidgetIdRef.current = null;
      }
    };
  }, [mode, turnstileReady, turnstileSiteKey]);

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
    if (!turnstileSiteKey) {
      setMsg("Brak publicznego klucza Turnstile. Dodaj NEXT_PUBLIC_TURNSTILE_SITE_KEY w Vercel i zrob redeploy.");
      return;
    }
    const currentTurnstileToken = turnstileTokenRef.current;
    if (!currentTurnstileToken) {
      setMsg("Potwierdz zabezpieczenie antybotowe i sproboj ponownie.");
      return;
    }
    setBusy(true);

    const signupRes = await fetch("/api/auth/signup", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        pseudonym,
        email: email.trim().toLowerCase(),
        password,
        turnstileToken: currentTurnstileToken,
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
      } else if (
        signupJson.error === "missing_turnstile_token" ||
        signupJson.error === "turnstile_rejected" ||
        signupJson.error === "turnstile_verify_failed"
      ) {
        setMsg("Potwierdz zabezpieczenie antybotowe i sproboj ponownie.");
      } else if (signupJson.error === "turnstile_not_configured") {
        setMsg("Rejestracja wymaga konfiguracji zabezpieczenia antybotowego.");
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

  async function doForgotPassword() {
    setMsg(null);
    const normalizedEmail = email.trim().toLowerCase();
    if (!normalizedEmail) {
      setMsg("Podaj email konta.");
      return;
    }

    setBusy(true);
    const supabase = getSupabaseBrowserClient();
    const { error } = await supabase.auth.resetPasswordForEmail(normalizedEmail, {
      redirectTo: `${window.location.origin}/auth/reset`,
    });
    setBusy(false);

    if (error) {
      setMsg(`Blad resetu hasla: ${mapAuthError(error.message)}`);
      return;
    }

    setMsg("Jesli konto istnieje, wyslalismy link do resetu hasla na podany email.");
  }

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (mode === "login") {
      await doLogin();
      return;
    }
    if (mode === "forgot") {
      await doForgotPassword();
      return;
    }
    await doSignup();
  }

  return (
    <main className="mx-auto max-w-md p-4 md:p-6">
      {turnstileSiteKey ? (
        <Script
          src="https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit"
          async
          defer
          onLoad={() => setTurnstileReady(true)}
        />
      ) : null}
      <Link className="underline opacity-80" href="/">
        Back
      </Link>

      <section className="mt-4 rounded-2xl border border-black/15 bg-white/70 p-4 shadow-[0_12px_28px_rgba(0,0,0,0.12)] backdrop-blur">
        <h1 className="text-2xl font-semibold">
          {mode === "login" ? "Logowanie" : mode === "signup" ? "Rejestracja" : "Reset hasla"}
        </h1>
        <p className="mt-1 text-sm opacity-80">
          {mode === "login"
            ? "Zaloguj sie, aby oceniac graczy i korzystac z paneli admina."
            : mode === "signup"
              ? "Utworz konto gracza: pseudonim + email + haslo."
              : "Podaj email konta, a wyslemy link do ustawienia nowego hasla."}
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

          {mode !== "forgot" ? (
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
          ) : null}

          {mode === "signup" && turnstileSiteKey ? (
            <div ref={turnstileContainerRef} className="min-h-[72px]" />
          ) : mode === "signup" ? (
            <p className="rounded-xl border border-amber-700/30 bg-amber-100/70 px-3 py-2 text-sm text-amber-950">
              Brak konfiguracji Turnstile po stronie przegladarki.
            </p>
          ) : null}

          <button
            className="rounded-xl border border-black/30 bg-black/90 px-4 py-2 font-semibold text-white disabled:opacity-60"
            type="submit"
            disabled={busy}
          >
            {busy
              ? "Prosze czekac..."
              : mode === "login"
                ? "Zaloguj"
                : mode === "signup"
                  ? "Utworz konto"
                  : "Wyslij link resetujacy"}
          </button>
        </form>

        <div className="mt-4 text-sm">
          {mode === "login" ? (
            <div className="flex flex-col gap-2">
              <button className="text-left underline opacity-90" type="button" onClick={() => setMode("signup")}>
                Nie masz konta? Zarejestruj sie
              </button>
              <button className="text-left underline opacity-90" type="button" onClick={() => setMode("forgot")}>
                Nie pamietasz hasla?
              </button>
            </div>
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
