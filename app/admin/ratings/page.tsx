"use client";

import { useEffect, useMemo, useState } from "react";

type Player = { id: string; name: string };

export default function AdminRatingsPage() {
  const [adminPass, setAdminPass] = useState("");
  const [players, setPlayers] = useState<Player[]>([]);
  const [raterId, setRaterId] = useState("");
  const [ratedId, setRatedId] = useState("");
  const [value, setValue] = useState(7);
  const [msg, setMsg] = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      const res = await fetch("/api/public/players");
      const json = await res.json();
      setPlayers(json.players ?? []);
    })();
  }, []);

  const ratedOptions = useMemo(
    () => players.filter((p) => p.id !== raterId),
    [players, raterId]
  );

  async function submit() {
    setMsg(null);
    const res = await fetch("/api/admin/ratings", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-admin-password": adminPass,
      },
      body: JSON.stringify({ raterId, ratedId, value }),
    });

    const json = await res.json().catch(() => ({}));
    if (!res.ok) {
      setMsg(`Błąd: ${json.error ?? res.statusText}`);
      return;
    }

    setMsg("Zapisano ocenę ✅");
  }

  return (
    <main className="p-6">
      <h1 className="text-2xl font-semibold">Admin • Oceny</h1>

      <div className="mt-4 max-w-xl rounded-xl border p-4 space-y-4">
        <div className="space-y-1">
          <label className="text-sm font-medium">Hasło admina</label>
          <input
            className="w-full rounded-lg border px-3 py-2"
            type="password"
            value={adminPass}
            onChange={(e) => setAdminPass(e.target.value)}
            placeholder="ADMIN_PASSWORD"
          />
        </div>

        <div className="grid gap-4 md:grid-cols-2">
          <div className="space-y-1">
            <label className="text-sm font-medium">Oceniający</label>
            <select
              className="w-full rounded-lg border px-3 py-2"
              value={raterId}
              onChange={(e) => {
                setRaterId(e.target.value);
                if (e.target.value === ratedId) setRatedId("");
              }}
            >
              <option value="">— wybierz —</option>
              {players.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </select>
          </div>

          <div className="space-y-1">
            <label className="text-sm font-medium">Oceniany</label>
            <select
              className="w-full rounded-lg border px-3 py-2"
              value={ratedId}
              onChange={(e) => setRatedId(e.target.value)}
              disabled={!raterId}
            >
              <option value="">— wybierz —</option>
              {ratedOptions.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </select>
          </div>
        </div>

        <div className="space-y-1">
          <label className="text-sm font-medium">Ocena: {value}</label>
          <input
            className="w-full"
            type="range"
            min={1}
            max={10}
            step={1}
            value={value}
            onChange={(e) => setValue(Number(e.target.value))}
          />
        </div>

        <button
          className="rounded-lg border px-3 py-2 disabled:opacity-50"
          onClick={submit}
          disabled={!adminPass || !raterId || !ratedId}
        >
          Zapisz (upsert)
        </button>

        {msg && <p className="text-sm opacity-80">{msg}</p>}
      </div>
    </main>
  );
}