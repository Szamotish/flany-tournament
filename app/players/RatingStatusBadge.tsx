"use client";

import { useEffect, useState } from "react";
import { authedFetch } from "@/lib/authClient";
import type { RatingCooldownState } from "@/lib/ratingCooldown";

type RatingStatusBadgeProps = {
  playerId: string;
  averageLabel: string;
};

function badgeTone(state: RatingCooldownState | "unknown" | "self"): string {
  if (state === "ready") return "border-emerald-700/40 bg-emerald-100/80 text-emerald-900";
  if (state === "soon") return "border-amber-700/45 bg-amber-100/80 text-amber-900";
  if (state === "self") return "border-slate-600/35 bg-slate-100/80 text-slate-800";
  if (state === "unknown") return "border-slate-500/30 bg-white/60 text-slate-800";
  return "border-rose-700/40 bg-rose-100/80 text-rose-900";
}

function badgeLabel(state: RatingCooldownState | "unknown" | "self"): string {
  if (state === "ready") return "GO";
  if (state === "soon") return "~1d";
  if (state === "self") return "TY";
  if (state === "unknown") return "...";
  return "CD";
}

export default function RatingStatusBadge({ playerId, averageLabel }: RatingStatusBadgeProps) {
  const [state, setState] = useState<RatingCooldownState | "unknown" | "self">("unknown");
  const [hint, setHint] = useState("Sprawdzanie statusu oceny...");

  useEffect(() => {
    let mounted = true;

    async function loadStatus() {
      const res = await authedFetch(`/api/public/my-rating?ratedId=${encodeURIComponent(playerId)}`, {
        cache: "no-store",
      });
      const json = await res.json().catch(() => ({}));
      if (!mounted) return;

      if (!res.ok) {
        setState("unknown");
        setHint("Zaloguj sie, aby sprawdzic status oceniania.");
        return;
      }

      if (json.isSelf === true) {
        setState("self");
        setHint("Nie mozesz ocenic samego siebie.");
        return;
      }

      const nextState =
        json.cooldownState === "ready" || json.cooldownState === "soon" || json.cooldownState === "cooldown"
          ? json.cooldownState
          : "unknown";
      setState(nextState);
      setHint(typeof json.message === "string" ? json.message : "Status oceniania niedostepny.");
    }

    void loadStatus();
    return () => {
      mounted = false;
    };
  }, [playerId]);

  return (
    <span
      title={hint}
      className={`inline-flex h-12 min-w-[3.2rem] sm:min-w-[3.6rem] flex-col items-center justify-center rounded-lg border px-2 ${badgeTone(
        state
      )}`}
    >
      <span className="text-sm font-extrabold leading-none">{averageLabel}</span>
      <span className="text-[0.58rem] font-semibold uppercase tracking-[0.08em] leading-none mt-1">
        {badgeLabel(state)}
      </span>
    </span>
  );
}
