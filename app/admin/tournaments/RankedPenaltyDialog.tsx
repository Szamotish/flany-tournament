"use client";

import { useEffect, useRef, useState } from "react";
import { authedFetch } from "@/lib/authClient";
import { applyRankedPenalty } from "@/lib/ranked";

export default function RankedPenaltyDialog({ player, onClose, onSaved }: {
  player: { id: string; name: string; mmr?: number | null; prestige_points?: number | null };
  onClose: () => void; onSaved: () => void;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const request = useRef<{ penaltyId: string; points: number; note: string } | null>(null);
  const [amount, setAmount] = useState("1");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [error, setError] = useState("");
  useEffect(() => { dialog.current?.showModal(); }, []);
  const points = Number(amount);
  const valid = Number.isInteger(points) && points >= 1 && points <= 100;
  const preview = valid ? applyRankedPenalty({ mmr: player.mmr ?? 5, prestigePoints: player.prestige_points ?? 0 }, points) : null;

  async function save() {
    if (busy) return;
    if (!valid || !note.trim() || note.length > 500) {
      setError("Podaj od 1 do 100 punktów i uzasadnienie do 500 znaków.");
      return;
    }
    request.current ??= { penaltyId: crypto.randomUUID(), points, note: note.trim() };
    setBusy(true);
    setSubmitted(true);
    setError("");
    try {
      const response = await authedFetch(`/api/admin/players/${player.id}/penalty`, {
        method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(request.current),
      });
      const result = await response.json();
      if (!response.ok) {
        setError(result.penaltySaved
          ? "Kara zapisana, ale przeliczenie się nie powiodło. Ponów zapis — punkty nie zostaną odjęte drugi raz."
          : `Nie udało się potwierdzić kary: ${result.error ?? response.statusText}. Możesz ponowić zapis.`);
        return;
      }
      onSaved();
    } catch {
      setError("Nie udało się potwierdzić zapisu. Ponów zapis — ta sama kara nie zostanie naliczona drugi raz.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <dialog ref={dialog} className="performance-bonus-dialog" aria-labelledby="ranked-penalty-title"
      onCancel={event => { event.preventDefault(); if (!busy) onClose(); }}>
      <form onSubmit={event => { event.preventDefault(); void save(); }}>
        <h2 id="ranked-penalty-title">Kara punktowa</h2>
        <p className="mt-2">Zawodnik: <strong>{player.name}</strong></p>
        <label className="mt-4 block">Punkty do odjęcia
          <input autoFocus type="number" min={1} max={100} step={1} inputMode="numeric"
            className="mt-1 block w-full rounded-lg border p-2" value={amount}
            onChange={event => setAmount(event.target.value)} disabled={submitted} required />
        </label>
        <p className="mt-2 text-sm">1 punkt = 1 PP lub 0,1 MMR. Najpierw odejmowane są PP, potem MMR.</p>
        {preview ? <p className="mt-2 text-sm">Po karze: <strong>{preview.mmr.toLocaleString("pl-PL")} MMR · {preview.prestigePoints} PP</strong></p> : null}
        <label className="mt-4 block">Uzasadnienie
          <textarea className="mt-1 block w-full rounded-lg border p-2" maxLength={500} rows={2}
            value={note} onChange={event => setNote(event.target.value)} disabled={submitted} required />
        </label>
        {error ? <p className="mt-3 text-sm text-red-800" role="alert">{error}</p> : null}
        <div className="mt-5 flex justify-end gap-2">
          <button type="button" className="tour-action-btn" onClick={onClose} disabled={busy}>Zamknij</button>
          <button type="submit" className="tour-action-btn" disabled={busy}>
            {busy ? "Zapisywanie…" : submitted ? "Ponów zapis" : "Nałóż karę"}
          </button>
        </div>
      </form>
    </dialog>
  );
}
