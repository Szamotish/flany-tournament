"use client";

import { useState } from "react";
import { authedFetch } from "@/lib/authClient";

export default function AdminTeamsPage() {
  const [teamSize, setTeamSize] = useState(5);
  const [allowUneven, setAllowUneven] = useState(true);
  const [iterations, setIterations] = useState(500);
  const [msg, setMsg] = useState<string | null>(null);
  const [mode, setMode] = useState<"reset" | "overwrite">("reset");

  async function generate() {
    setMsg(null);

    const res = await authedFetch("/api/admin/teams/generate", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ teamSize, allowUneven, iterations, mode }),
    });

    const json = await res.json().catch(() => ({}));
    if (!res.ok) {
      setMsg(`Blad: ${json.error ?? res.statusText}`);
      return;
    }

    setMsg(`Wygenerowano. batchId=${json.batchId} (score=${json.score})`);
  }

  return (
    <main className="p-6">
      <h1 className="text-2xl font-semibold">Admin - Druzyny</h1>

      <div className="mt-4 max-w-xl rounded-xl border p-4 space-y-4">
        <div className="grid gap-4 md:grid-cols-2">
          <div className="space-y-1">
            <label className="text-sm font-medium">Rozmiar druzyny</label>
            <input
              className="w-full rounded-lg border px-3 py-2"
              type="number"
              min={2}
              max={20}
              value={teamSize}
              onChange={(e) => setTeamSize(Number(e.target.value))}
            />
          </div>

          <div className="space-y-1">
            <label className="text-sm font-medium">Iteracje</label>
            <input
              className="w-full rounded-lg border px-3 py-2"
              type="number"
              min={1}
              max={5000}
              value={iterations}
              onChange={(e) => setIterations(Number(e.target.value))}
            />
          </div>
        </div>

        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" checked={allowUneven} onChange={(e) => setAllowUneven(e.target.checked)} />
          Dopusc nierowne druzyny (roznica max 1)
        </label>

        <div className="space-y-2">
          <p className="text-sm font-medium">Tryb</p>
          <label className="flex items-center gap-2 text-sm">
            <input type="radio" name="mode" checked={mode === "reset"} onChange={() => setMode("reset")} />
            Reset (zarchiwizuj poprzednie)
          </label>

          <label className="flex items-center gap-2 text-sm">
            <input type="radio" name="mode" checked={mode === "overwrite"} onChange={() => setMode("overwrite")} />
            Nadpisz (usun poprzednie)
          </label>
        </div>

        <button className="rounded-lg border px-3 py-2 disabled:opacity-50" onClick={generate}>
          Generuj i zapisz
        </button>

        {msg ? <p className="text-sm opacity-80">{msg}</p> : null}
      </div>
    </main>
  );
}
