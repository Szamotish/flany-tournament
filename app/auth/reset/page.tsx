"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { getSupabaseBrowserClient } from "@/lib/supabaseBrowser";

export default function ResetPasswordPage() {
  const router = useRouter();
  const [ready, setReady] = useState(false);
  const [password, setPassword] = useState("");
  const [passwordRepeat, setPasswordRepeat] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>("Sprawdzanie linku resetujacego...");

  useEffect(() => {
    let cancelled = false;
    const supabase = getSupabaseBrowserClient();

    const { data: listener } = supabase.auth.onAuthStateChange((event, session) => {
      if (cancelled) return;
      if (event === "PASSWORD_RECOVERY" || session) {
        setReady(true);
        setMsg(null);
      }
    });

    void supabase.auth.getSession().then(({ data }) => {
      if (cancelled) return;
      if (data.session) {
        setReady(true);
        setMsg(null);
      } else {
        setReady(false);
        setMsg("Link resetujacy jest nieaktywny albo wygasl. Wygeneruj nowy link.");
      }
    });

    return () => {
      cancelled = true;
      listener.subscription.unsubscribe();
    };
  }, []);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setMsg(null);

    if (password.length < 8) {
      setMsg("Haslo musi miec min. 8 znakow.");
      return;
    }
    if (password !== passwordRepeat) {
      setMsg("Hasla nie sa takie same.");
      return;
    }

    setBusy(true);
    const supabase = getSupabaseBrowserClient();
    const { error } = await supabase.auth.updateUser({ password });
    if (error) {
      setBusy(false);
      setMsg(`Blad zmiany hasla: ${error.message}`);
      return;
    }

    await supabase.auth.signOut();
    router.replace("/auth?reset=done");
    router.refresh();
  }

  return (
    <main className="mx-auto max-w-md p-4 md:p-6">
      <Link className="underline opacity-80" href="/auth">
        Back
      </Link>

      <section className="mt-4 rounded-2xl border border-black/15 bg-white/70 p-4 shadow-[0_12px_28px_rgba(0,0,0,0.12)] backdrop-blur">
        <h1 className="text-2xl font-semibold">Ustaw nowe haslo</h1>
        <p className="mt-1 text-sm opacity-80">Wpisz nowe haslo do swojego konta.</p>

        <form className="mt-4 space-y-3" onSubmit={submit}>
          <div>
            <label className="block text-sm font-medium">Nowe haslo</label>
            <input
              className="mt-1 w-full rounded-lg border border-black/25 bg-white/90 px-3 py-2"
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              minLength={8}
              disabled={!ready || busy}
              required
            />
          </div>

          <div>
            <label className="block text-sm font-medium">Powtorz haslo</label>
            <input
              className="mt-1 w-full rounded-lg border border-black/25 bg-white/90 px-3 py-2"
              type="password"
              value={passwordRepeat}
              onChange={(e) => setPasswordRepeat(e.target.value)}
              minLength={8}
              disabled={!ready || busy}
              required
            />
          </div>

          <button
            className="rounded-xl border border-black/30 bg-black/90 px-4 py-2 font-semibold text-white disabled:opacity-60"
            type="submit"
            disabled={!ready || busy}
          >
            {busy ? "Zapisywanie..." : "Zmien haslo"}
          </button>
        </form>

        {msg ? <p className="mt-3 text-sm text-amber-900">{msg}</p> : null}
      </section>
    </main>
  );
}
