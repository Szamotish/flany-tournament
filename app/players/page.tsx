import Link from "next/link";
import { supabaseServer } from "@/lib/supabaseServer";
import { trimmedMean } from "@/lib/rating";
import { loadPlayerPerformance } from "@/lib/playerPerformance";
import {
  FRAME_BY_RANK,
  canShowRankFromMmr,
  displayRankFromProgress,
  rankLabel,
} from "@/lib/playerRank";

export const dynamic = "force-dynamic";

type PlayerRow = {
  id: string;
  name: string;
  active: boolean;
  avatar_url: string | null;
  mmr: number | null;
  prestige_points: number | null;
  rating_override?: number | null;
  mmr_manual_override?: boolean | null;
  rank_frame_enabled?: boolean | null;
};

type CooldownState = "ready" | "cooldown" | "soon";

function badgeTone(state: CooldownState): string {
  if (state === "ready") {
    return "border-emerald-700/40 bg-emerald-100/80 text-emerald-900";
  }
  if (state === "soon") {
    return "border-amber-700/45 bg-amber-100/80 text-amber-900";
  }
  return "border-rose-700/40 bg-rose-100/80 text-rose-900";
}

function badgeLabel(state: CooldownState): string {
  if (state === "ready") return "GO";
  if (state === "soon") return "~1d";
  return "CD";
}

function formatAverage(value: number | null): string {
  if (value === null || !Number.isFinite(value)) return "--";
  return value.toFixed(1);
}

function formatMmr(value: number | null): string {
  const mmr = Number(value ?? 0);
  if (!Number.isFinite(mmr)) return "0.0";
  return mmr.toFixed(1);
}

export default async function PlayersPage() {
  const selectWithSettings =
    "id,name,active,avatar_url,mmr,prestige_points,rating_override,mmr_manual_override,rank_frame_enabled";
  const selectLegacy = "id,name,active,avatar_url,mmr,prestige_points";

  const primaryPlayers = await supabaseServer
    .from("players")
    .select(selectWithSettings)
    .eq("active", true)
    .order("name", { ascending: true });

  let players: PlayerRow[] = (primaryPlayers.data ?? []) as PlayerRow[];
  let error = primaryPlayers.error;

  if (
    primaryPlayers.error &&
    (primaryPlayers.error.message.includes("mmr_manual_override") ||
      primaryPlayers.error.message.includes("rating_override") ||
      primaryPlayers.error.message.includes("rank_frame_enabled"))
  ) {
    const fallback = await supabaseServer
      .from("players")
      .select(selectLegacy)
      .eq("active", true)
      .order("name", { ascending: true });

    players = ((fallback.data ?? []) as PlayerRow[]).map((row) => ({
      ...row,
      mmr_manual_override: false,
      rating_override: null,
      rank_frame_enabled: true,
    }));
    error = fallback.error;
  }
  const playerIds = players.map((player) => player.id);

  const averageRatingByPlayer = new Map<string, number | null>();
  for (const player of players) {
    averageRatingByPlayer.set(player.id, null);
  }

  let ratingsError: string | null = null;
  if (playerIds.length > 0) {
    const { data: ratingsData, error: ratingsQueryError } = await supabaseServer
      .from("ratings")
      .select("rated_player_id,value")
      .in("rated_player_id", playerIds);

    if (ratingsQueryError) {
      ratingsError = ratingsQueryError.message;
    } else {
      const grouped = new Map<string, number[]>();
      for (const row of ratingsData ?? []) {
        const playerId = typeof row.rated_player_id === "string" ? row.rated_player_id : "";
        const value = Number(row.value);
        if (!playerId || !Number.isFinite(value)) continue;
        const current = grouped.get(playerId) ?? [];
        current.push(value);
        grouped.set(playerId, current);
      }

      for (const playerId of playerIds) {
        const player = players.find((row) => row.id === playerId);
        const override = Number(player?.rating_override);
        averageRatingByPlayer.set(
          playerId,
          Number.isFinite(override) ? override : trimmedMean(grouped.get(playerId) ?? [])
        );
      }
    }
  }

  const cooldownByPlayer = new Map<string, { state: CooldownState; hint: string }>();
  for (const player of players) {
    cooldownByPlayer.set(player.id, { state: "ready", hint: "Mozesz teraz wystawic ocene." });
  }

  const effectiveMmrByPlayer = new Map<string, number>();
  const hasFinishedMatchByPlayer = new Map<string, boolean>();
  const mmrManualOverrideByPlayer = new Map<string, boolean>();
  for (const player of players) {
    mmrManualOverrideByPlayer.set(player.id, player.mmr_manual_override === true);
  }
  if (playerIds.length > 0) {
    try {
      const perfByPlayer = await loadPlayerPerformance(playerIds);
      for (const playerId of playerIds) {
        const perf = perfByPlayer.get(playerId);
        if (!perf) continue;
        effectiveMmrByPlayer.set(playerId, perf.effectiveMmr);
        hasFinishedMatchByPlayer.set(playerId, perf.hasFinishedMatch);
        mmrManualOverrideByPlayer.set(playerId, perf.mmrManualOverride);
      }
    } catch {
      // Keep fallback to stored MMR when performance helper fails.
    }
  }

  return (
    <main className="p-4 md:p-6 overflow-x-clip">
      <Link className="underline opacity-80" href="/">
        Back
      </Link>

      <h1 className="mt-4 text-3xl font-semibold">Zawodnicy</h1>

      {error ? (
        <p className="mt-3 text-sm text-red-600">Blad pobierania: {error.message}</p>
      ) : players.length === 0 ? (
        <p className="mt-3 text-sm opacity-70">Brak zawodnikow.</p>
      ) : (
        <div className="mt-4 grid gap-2 md:grid-cols-2 min-w-0">
          {players.map((p) => {
            const mmr = Number(effectiveMmrByPlayer.get(p.id) ?? p.mmr ?? 0);
            const hasFinishedMatch = hasFinishedMatchByPlayer.get(p.id) ?? false;
            const mmrManualOverride = mmrManualOverrideByPlayer.get(p.id) ?? false;
            const prestigePoints = Math.max(0, Math.floor(Number(p.prestige_points ?? 0)));
            const canShowRank = canShowRankFromMmr(hasFinishedMatch, mmrManualOverride);
            const rank = displayRankFromProgress(canShowRank, mmr, prestigePoints);
            const shownRankLabel = rankLabel(rank);
            const frameUrl = p.rank_frame_enabled === false ? null : FRAME_BY_RANK[rank];
            const frameClass = `player-rank-tier-${rank}`;

            return (
              <Link key={p.id} href={`/players/${p.id}`} className="block min-w-0 no-underline">
                <div className={`player-rank-card ${frameClass}`}>
                  <div className="player-rank-main">
                    <span className={`player-rank-avatar-wrap${frameUrl ? " has-frame" : ""}`}>
                      <span className="player-rank-avatar">
                        {p.avatar_url ? (
                          <span
                            className="block h-full w-full bg-cover bg-center"
                            style={{ backgroundImage: `url('${p.avatar_url}')` }}
                          />
                        ) : (
                          p.name.slice(0, 1).toUpperCase()
                        )}
                      </span>
                      {frameUrl ? (
                        <span
                          className="player-rank-avatar-frame"
                          style={{ backgroundImage: `url('${frameUrl}')` }}
                          aria-hidden
                        />
                      ) : null}
                    </span>
                    <span className="player-rank-name truncate font-medium">{p.name}</span>
                  </div>

                  <div className="player-rank-right">
                    <span className="player-rank-state">{p.active ? "aktywny" : "nieaktywny"}</span>
                    <span
                      className="player-rank-pp"
                      title={`Ranga: ${shownRankLabel}`}
                    >
                      <span className="player-rank-pp-label">MMR {formatMmr(mmr)}</span>
                      <span className="player-rank-pp-value">
                        Ranga: {shownRankLabel}
                      </span>
                    </span>
                    <span
                      title={cooldownByPlayer.get(p.id)?.hint ?? "Status cooldownu niedostepny."}
                      className={`inline-flex h-12 min-w-[3.2rem] sm:min-w-[3.6rem] flex-col items-center justify-center rounded-lg border px-2 ${badgeTone(
                        cooldownByPlayer.get(p.id)?.state ?? "ready"
                      )}`}
                    >
                      <span className="text-sm font-extrabold leading-none">
                        {formatAverage(averageRatingByPlayer.get(p.id) ?? null)}
                      </span>
                      <span className="text-[0.58rem] font-semibold uppercase tracking-[0.08em] leading-none mt-1">
                        {badgeLabel(cooldownByPlayer.get(p.id)?.state ?? "ready")}
                      </span>
                    </span>
                  </div>
                </div>
              </Link>
            );
          })}
        </div>
      )}

      {ratingsError ? <p className="mt-3 text-xs text-red-600">Blad ocen: {ratingsError}</p> : null}
    </main>
  );
}
