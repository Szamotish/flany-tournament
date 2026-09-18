"use client";

import { useEffect, useRef, useState } from "react";
import { authedFetch } from "@/lib/authClient";

export default function PerformanceBonusDialog({ player, onClose, onSaved }: {
  player: { id: string; name: string }; onClose: () => void; onSaved: () => void;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const request = useRef<{ bonusId: string; delta: number; note: string } | null>(null);
  const [amount, setAmount] = useState("0.2");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [submitted, setSubmitted] = useState(false);
  useEffect(() => { dialog.current?.showModal(); }, []);
  const delta = Number(amount.replace(",", "."));

  async function save() {
    if (busy) return;
    if (!Number.isFinite(delta) || delta < 0.1 || delta > 10 || Math.abs(delta * 10 - Math.round(delta * 10)) > 1e-8) {
      setError("Podaj od 0,1 do 10 MMR, co 0,1.");
      return;
    }
    request.current ??= { bonusId: crypto.randomUUID(), delta, note };
    setBusy(true);
    setSubmitted(true);
    setError("");
    try {
      const response = await authedFetch(`/api/admin/players/${player.id}/performance-bonus`, {
        method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(request.current),
      });
      const result = await response.json();
      if (!response.ok) {
        setError(result.bonusSaved
          ? "Bonus zapisany. Przeliczenie nie powiodło się — ponów zapis, punkty nie zostaną dodane drugi raz."
          : `Nie udało się przyznać bonusu: ${result.error ?? response.statusText}. Możesz ponowić zapis.`);
        return;
      }
      onSaved();
    } catch {
      setError("Nie udało się potwierdzić zapisu. Ponów zapis — ta sama nagroda nie zostanie przyznana drugi raz.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <dialog ref={dialog} className="performance-bonus-dialog" aria-labelledby="performance-bonus-title"
      onCancel={(event) => { event.preventDefault(); if (!busy) onClose(); }}>
      <form onSubmit={(event) => { event.preventDefault(); void save(); }}>
        <p className="performance-bonus-eyebrow">Nagroda głównego admina</p>
        <h2 id="performance-bonus-title">Performance bonus</h2>
        <p className="mt-2">Zawodnik: <strong>{player.name}</strong></p>
        <label className="mt-4 block">Bonus MMR
          <input autoFocus className="mt-1 block w-full rounded-lg border p-2" inputMode="decimal"
            value={amount} onChange={(event) => setAmount(event.target.value)} disabled={submitted} required />
        </label>
        <p className="mt-2 text-sm">Przy 10 MMR: +{Number.isFinite(delta) ? Math.round(delta * 10) : "—"} PP. Nadwyżka ponad 10 MMR również przechodzi na PP.</p>
        <label className="mt-4 block">Uzasadnienie (opcjonalne)
          <textarea className="mt-1 block w-full rounded-lg border p-2" maxLength={500} rows={2}
            value={note} onChange={(event) => setNote(event.target.value)} disabled={submitted} />
        </label>
        <p className="mt-3 text-sm">Medal przy awatarze na 7 dni. Punkty pozostają w historii i są uwzględniane przy przeliczaniu MMR.</p>
        {error ? <p className="mt-3 text-sm text-red-800" role="alert">{error}</p> : null}
        <div className="mt-5 flex justify-end gap-2">
          <button type="button" className="tour-action-btn" onClick={onClose} disabled={busy}>Zamknij</button>
          <button type="submit" className="tour-action-btn" disabled={busy}>{busy ? "Zapisywanie…" : submitted ? "Ponów zapis" : "Przyznaj bonus"}</button>
        </div>
      </form>
    </dialog>
  );
}
