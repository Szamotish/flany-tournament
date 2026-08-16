import Link from "next/link";
import { supabaseServer } from "@/lib/supabaseServer";
import { trimmedMean } from "@/lib/rating";
import { loadPlayerPerformance } from "@/lib/playerPerformance";
import { rankingCompare, type RankingComparable } from "@/lib/ranking";
import { playerToneStyle } from "@/lib/ui/playerProfile";
import {
  FRAME_BY_RANK,
  canShowRankFromMmr,
  displayRankFromProgress,
  rankLabel,
  type DisplayRank,
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
  profile_color?: string | null;
};

type RankingPlayer = PlayerRow & {
  rating: number | null;
  effectiveMmr: number;
  prestigePoints: number;
  rank: DisplayRank;
  rankText: string;
  isRanked: boolean;
} & RankingComparable;

function formatMmr(value: number): string {
  if (!Number.isFinite(value)) return "0.0";
  return value.toFixed(1);
}

function formatRating(value: number | null): string {
  if (value === null || !Number.isFinite(value)) return "--";
  return value.toFixed(1);
}

export default async function RankingPage() {
  const selectWithSettings =
    "id,name,active,avatar_url,mmr,prestige_points,rating_override,mmr_manual_override,rank_frame_enabled,profile_color";
  const selectLegacy = "id,name,active,avatar_url,mmr,prestige_points";

  const primaryPlayers = await supabaseServer
    .from("players")
    .select(selectWithSettings)
    .eq("active", true);

  let players: PlayerRow[] = (primaryPlayers.data ?? []) as PlayerRow[];
  let error = primaryPlayers.error;

  if (
    primaryPlayers.error &&
    (primaryPlayers.error.message.includes("mmr_manual_override") ||
      primaryPlayers.error.message.includes("rating_override") ||
      primaryPlayers.error.message.includes("rank_frame_enabled") ||
      primaryPlayers.error.message.includes("profile_color"))
  ) {
    const fallback = await supabaseServer.from("players").select(selectLegacy).eq("active", true);

    players = ((fallback.data ?? []) as PlayerRow[]).map((row) => ({
      ...row,
      rating_override: null,
      mmr_manual_override: false,
      rank_frame_enabled: true,
      profile_color: null,
    }));
    error = fallback.error;
  }

  const playerIds = players.map((player) => player.id);
  const ratingByPlayer = new Map<string, number | null>();
  for (const player of players) {
    ratingByPlayer.set(player.id, null);
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
        grouped.set(playerId, [...(grouped.get(playerId) ?? []), value]);
      }

      for (const player of players) {
        const overrideRaw = player.rating_override;
        const override = Number(overrideRaw);
        ratingByPlayer.set(
          player.id,
          overrideRaw !== null && overrideRaw !== undefined && Number.isFinite(override)
            ? override
            : trimmedMean(grouped.get(player.id) ?? [])
        );
      }
    }
  }

  const perfByPlayer = playerIds.length > 0 ? await loadPlayerPerformance(playerIds).catch(() => new Map()) : new Map();

  const rankingPlayers: RankingPlayer[] = players
    .map((player) => {
      const perf = perfByPlayer.get(player.id);
      const effectiveMmr = Number(perf?.effectiveMmr ?? player.mmr ?? 0);
      const prestigePoints = Math.max(0, Math.floor(Number(player.prestige_points ?? 0)));
      const canShowRank = canShowRankFromMmr(
        perf?.hasFinishedMatch ?? false,
        perf?.mmrManualOverride ?? player.mmr_manual_override === true
      );
      const rank = displayRankFromProgress(canShowRank, effectiveMmr, prestigePoints);
      const isRanked = rank !== "unranked";

      return {
        ...player,
        rating: ratingByPlayer.get(player.id) ?? null,
        effectiveMmr,
        prestigePoints,
        rank,
        rankText: rankLabel(rank),
        isRanked,
      };
    })
    .sort(rankingCompare);

  let rankedPosition = 0;

  return (
    <main className="ranking-root">
      <Link className="underline opacity-80" href="/">
        Back
      </Link>

      <section className="ranking-hero glass-card mt-4">
        <p className="panel-top-label">Ranking ligi</p>
        <h1 className="ranking-title">Tabela Flanki League</h1>
        <p className="ranking-sub">
          Kolejnosc: ranga, punkty PP, MMR, rating. Gracze bez rozegranego ranked meczu sa na koncu jako Unranked.
        </p>
      </section>

      {error ? (
        <p className="mt-3 text-sm text-red-600">Blad pobierania: {error.message}</p>
      ) : rankingPlayers.length === 0 ? (
        <p className="mt-3 text-sm opacity-70">Brak zawodnikow.</p>
      ) : (
        <section className="ranking-list mt-4">
          {rankingPlayers.map((player) => {
            const frameUrl = player.rank_frame_enabled === false ? null : FRAME_BY_RANK[player.rank];
            const frameClass = `player-rank-tier-${player.rank}`;
            const place = player.isRanked ? `#${++rankedPosition}` : "Unranked";

            return (
              <Link key={player.id} href={`/players/${player.id}`} className="ranking-row-link">
                <article
                  className={`ranking-row player-rank-card ${frameClass} player-tone-card`}
                  style={playerToneStyle(player.profile_color)}
                >
                  <div className="ranking-place">{place}</div>
                  <div className="player-rank-main">
                    <span className={`player-rank-avatar-wrap${frameUrl ? " has-frame" : ""}`}>
                      <span className="player-rank-avatar">
                        {player.avatar_url ? (
                          <span
                            className="block h-full w-full bg-cover bg-center"
                            style={{ backgroundImage: `url('${player.avatar_url}')` }}
                          />
                        ) : (
                          player.name.slice(0, 1).toUpperCase()
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
                    <span className="player-rank-name truncate font-medium">{player.name}</span>
                  </div>

                  <div className="ranking-stats">
                    <span className="ranking-chip ranking-chip-rank">{player.rankText}</span>
                    <span className="ranking-chip">MMR {formatMmr(player.effectiveMmr)}</span>
                    <span className="ranking-chip">PP {player.prestigePoints}</span>
                    <span className="ranking-chip">Rating {formatRating(player.rating)}</span>
                  </div>
                </article>
              </Link>
            );
          })}
        </section>
      )}

      {ratingsError ? <p className="mt-3 text-xs text-red-600">Blad ocen: {ratingsError}</p> : null}
    </main>
  );
}
