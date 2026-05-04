"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { authedFetch } from "@/lib/authClient";

type Tournament = {
  id: string;
  name: string;
  format: "single_elim" | "double_elim" | null;
  mode: "normal" | "ranked" | null;
  bo_default: number | null;
  bo_finals: number | null;
  event_at: string | null;
  event_location: string | null;
  is_private?: boolean | null;
};

function formatDateTime(iso: string | null): string {
  if (!iso) return "brak terminu";
  const parsed = new Date(iso);
  if (Number.isNaN(parsed.getTime())) return "brak terminu";
  return parsed.toLocaleString("pl-PL", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export default function TournamentsPrivateList({ publicIds }: { publicIds: string[] }) {
  const [privateTournaments, setPrivateTournaments] = useState<Tournament[]>([]);

  useEffect(() => {
    let mounted = true;
    const publicSet = new Set(publicIds);

    async function loadPrivateTournaments() {
      const res = await authedFetch("/api/public/tournaments", { cache: "no-store" });
      if (!res.ok) return;
      const json = await res.json().catch(() => ({}));
      const next = ((json.tournaments ?? []) as Tournament[]).filter(
        (t) => t.is_private === true && !publicSet.has(t.id)
      );
      if (mounted) setPrivateTournaments(next);
    }

    void loadPrivateTournaments();
    return () => {
      mounted = false;
    };
  }, [publicIds]);

  if (privateTournaments.length === 0) return null;

  return (
    <section className="tour-list mt-4">
      {privateTournaments.map((t) => (
        <Link key={t.id} href={`/tournaments/${t.id}`} className="tour-card tour-card-private">
          <div className="tour-card-head">
            <div>
              <p className="tour-card-title">{t.name}</p>
              <p className="tour-card-sub">
                Prywatny - {t.mode === "ranked" ? "Ranked" : "Normal"} -{" "}
                {t.format === "double_elim" ? "Double elimination" : "Single elimination"} - BO
                {t.bo_default} / final BO{t.bo_finals}
              </p>
              <p className="tour-card-sub">
                {formatDateTime(t.event_at)}
                {t.event_location ? ` - ${t.event_location}` : ""}
              </p>
            </div>
            <span className="tour-status">Prywatny</span>
          </div>
          <p className="tour-muted mt-3">
            Widzisz ten turniej, bo jestes uczestnikiem albo masz aktywne zaproszenie.
          </p>
        </Link>
      ))}
    </section>
  );
}
