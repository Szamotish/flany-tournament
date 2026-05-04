import Link from "next/link";
import RatePlayer from "./RatePlayer";
import UploadAvatar from "./UploadAvatar";
import ProfileSettingsButton from "./ProfileSettingsButton";
import BeerCan3D from "@/app/components/BeerCan3D";
import { trimmedMean } from "@/lib/rating";
import { supabaseServer } from "@/lib/supabaseServer";
import TrophyIcon from "@/app/components/TrophyIcon";
import BackNavButton from "@/app/components/BackNavButton";
import { PRESTIGE_POINTS_PER_MMR } from "@/lib/ranked";
import { loadPlayerPerformance } from "@/lib/playerPerformance";
import { playerToneStyle } from "@/lib/ui/playerProfile";
import {
  FRAME_BY_RANK,
  canShowRankFromMmr,
  displayRankFromProgress,
  rankLabel,
} from "@/lib/playerRank";

export const dynamic = "force-dynamic";

type PlayerBrief = { id: string; name: string };

type HistoryEntry = {
  tournamentId: string;
  tournamentName: string;
  tournamentCreatedAt: string | null;
  teamId: string;
  teamName: string;
  placement: number;
  teamRoster: PlayerBrief[];
};

type MmrPoint = {
  mmr: number;
  createdAt: string | null;
};

type SparkPoint = {
  x: number;
  y: number;
  mmr: number;
  createdAt: string | null;
};

const CHART_WIDTH = 220;
const CHART_HEIGHT = 88;
const CHART_PAD_X = 10;
const CHART_PAD_Y = 8;

function formatShortDate(iso: string | null): string {
  if (!iso) return "--.--";
  return new Date(iso).toLocaleDateString("pl-PL", { day: "2-digit", month: "2-digit" });
}

function formatPlacement(place: number): string {
  const n = Math.max(1, Math.floor(place));
  const mod100 = n % 100;
  if (mod100 >= 11 && mod100 <= 13) return `${n}th`;
  const mod10 = n % 10;
  if (mod10 === 1) return `${n}st`;
  if (mod10 === 2) return `${n}nd`;
  if (mod10 === 3) return `${n}rd`;
  return `${n}th`;
}

function parsePlayerBrief(value: unknown): PlayerBrief | null {
  const source = Array.isArray(value) ? value[0] : value;
  if (!source || typeof source !== "object") return null;
  const player = source as { id?: unknown; name?: unknown };
  if (typeof player.id !== "string" || typeof player.name !== "string") return null;
  return { id: player.id, name: player.name };
}

function prestigeTier(pointsValue: number | null): number {
  const points = Number(pointsValue ?? 0);
  if (!Number.isFinite(points) || points <= 0) return 0;
  return Math.floor(points / PRESTIGE_POINTS_PER_MMR);
}

function prestigeColor(tier: number): string {
  if (tier <= 0) return "rgba(80, 48, 8, 0.24)";
  const tones = ["#059669", "#0284c7", "#7c3aed", "#d97706", "#e11d48", "#65a30d"];
  return tones[(tier - 1) % tones.length];
}

function formatChartTooltipDateTime(iso: string | null): string {
  if (!iso) return "--.-- --:--";
  const parsed = new Date(iso);
  if (Number.isNaN(parsed.getTime())) return "--.-- --:--";
  const day = String(parsed.getDate()).padStart(2, "0");
  const month = String(parsed.getMonth() + 1).padStart(2, "0");
  const hours = String(parsed.getHours()).padStart(2, "0");
  const minutes = String(parsed.getMinutes()).padStart(2, "0");
  return `${day}.${month} ${hours}:${minutes}`;
}

function buildSparkPoints(points: MmrPoint[]): SparkPoint[] {
  if (points.length === 0) return [];
  const minY = 0;
  const maxY = 10;
  const drawableWidth = CHART_WIDTH - CHART_PAD_X * 2;
  const drawableHeight = CHART_HEIGHT - CHART_PAD_Y * 2;
  const step = points.length > 1 ? drawableWidth / (points.length - 1) : 0;
  return points.map((point, index) => {
    const x = CHART_PAD_X + step * index;
    const clamped = Math.max(minY, Math.min(maxY, Number(point.mmr ?? 0)));
    const y = CHART_PAD_Y + drawableHeight - (clamped / (maxY - minY)) * drawableHeight;
    return {
      x,
      y,
      mmr: clamped,
      createdAt: point.createdAt,
    };
  });
}

export default async function PlayerPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id: playerId } = await params;

  const primaryPlayer = await supabaseServer
    .from("players")
    .select("id,name,active,avatar_url,mmr,prestige_points,rating_override,mmr_manual_override,rank_frame_enabled,profile_color,favorite_beer")
    .eq("id", playerId)
    .maybeSingle();

  let player = primaryPlayer.data;
  let playerErr = primaryPlayer.error;

  if (
    primaryPlayer.error &&
    (primaryPlayer.error.message.includes("mmr_manual_override") ||
      primaryPlayer.error.message.includes("rating_override") ||
      primaryPlayer.error.message.includes("rank_frame_enabled") ||
      primaryPlayer.error.message.includes("profile_color") ||
      primaryPlayer.error.message.includes("favorite_beer"))
  ) {
    const fallback = await supabaseServer
      .from("players")
      .select("id,name,active,avatar_url,mmr,prestige_points")
      .eq("id", playerId)
      .maybeSingle();

    player = fallback.data
      ? {
          ...fallback.data,
          rating_override: null,
          mmr_manual_override: false,
          rank_frame_enabled: true,
          profile_color: null,
          favorite_beer: null,
        }
      : null;
    playerErr = fallback.error;
  }

  if (playerErr) {
    return (
      <main className="player-profile-root">
        <BackNavButton className="underline opacity-80" fallbackHref="/players" />
        <p className="mt-4 text-red-600">Blad: {playerErr.message}</p>
      </main>
    );
  }

  if (!player) {
    return (
      <main className="player-profile-root">
        <BackNavButton className="underline opacity-80" fallbackHref="/players" />
        <p className="mt-4 text-red-600">Nie znaleziono zawodnika.</p>
      </main>
    );
  }

  const { data: ratings, error: ratingsErr } = await supabaseServer
    .from("ratings")
    .select("value")
    .eq("rated_player_id", playerId);

  const ratingValues = (ratings ?? []).map((r) => Number(r.value)).filter(Number.isFinite);
  const ratingOverrideRaw = (player as { rating_override?: number | null }).rating_override;
  const ratingOverride = Number(ratingOverrideRaw);
  const rating =
    ratingOverrideRaw !== null && ratingOverrideRaw !== undefined && Number.isFinite(ratingOverride)
      ? ratingOverride
      : trimmedMean(ratingValues, 0.1);

  const { data: memberships, error: membershipsErr } = await supabaseServer
    .from("team_members")
    .select("team_id")
    .eq("player_id", playerId);

  const teamIds = (memberships ?? []).map((x) => String(x.team_id));

  let beers = 0;
  let history: HistoryEntry[] = [];

  if (teamIds.length > 0) {
    const { data: beerMatches, error: beersErr } = await supabaseServer
      .from("tournament_matches")
      .select("team_a_id,team_b_id,status")
      .eq("status", "finished")
      .or(`team_a_id.in.(${teamIds.join(",")}),team_b_id.in.(${teamIds.join(",")})`);

    if (!beersErr) {
      beers = (beerMatches ?? []).reduce((sum, m) => {
        const hasA = typeof m.team_a_id === "string" && m.team_a_id.length > 0;
        const hasB = typeof m.team_b_id === "string" && m.team_b_id.length > 0;
        return sum + (hasA && hasB ? 1 : 0);
      }, 0);
    }

    const { data: results, error: resultsErr } = await supabaseServer
      .from("tournament_results")
      .select("tournament_id,team_id,placement")
      .in("team_id", teamIds)
      .order("placement", { ascending: true });

    if (!resultsErr) {
      const tournamentIds = Array.from(new Set((results ?? []).map((r) => String(r.tournament_id))));

      const tournamentsMap = new Map<string, { name: string; created_at: string | null }>();
      const teamsMap = new Map<string, string>();
      const rosterMap = new Map<string, PlayerBrief[]>();

      if (tournamentIds.length > 0) {
        const { data: tournaments } = await supabaseServer
          .from("tournaments")
          .select("id,name,created_at")
          .in("id", tournamentIds);

        for (const t of tournaments ?? []) {
          tournamentsMap.set(String(t.id), {
            name: String(t.name ?? "(unknown)"),
            created_at: t.created_at ? String(t.created_at) : null,
          });
        }
      }

      const { data: teams } = await supabaseServer
        .from("teams")
        .select("id,name")
        .in("id", teamIds);

      for (const t of teams ?? []) {
        teamsMap.set(String(t.id), String(t.name ?? "Druzyna"));
      }

      const { data: members } = await supabaseServer
        .from("team_members")
        .select("team_id, players(id,name)")
        .in("team_id", teamIds);

      for (const m of members ?? []) {
        const teamId = String(m.team_id);
        const playerRef = parsePlayerBrief((m as { players?: unknown }).players);
        if (!playerRef) continue;
        const current = rosterMap.get(teamId) ?? [];
        current.push(playerRef);
        rosterMap.set(teamId, current);
      }

      for (const [key, roster] of rosterMap.entries()) {
        rosterMap.set(
          key,
          roster.sort((a, b) => a.name.localeCompare(b.name, "pl"))
        );
      }

      history = (results ?? []).map((r) => {
        const tournamentId = String(r.tournament_id);
        const teamId = String(r.team_id);
        const t = tournamentsMap.get(tournamentId);

        return {
          tournamentId,
          tournamentName: t?.name ?? "(unknown)",
          tournamentCreatedAt: t?.created_at ?? null,
          teamId,
          teamName: teamsMap.get(teamId) ?? "Druzyna",
          placement: Number(r.placement ?? 0),
          teamRoster: rosterMap.get(teamId) ?? [],
        };
      });

      history.sort((a, b) => {
        const da = a.tournamentCreatedAt ? new Date(a.tournamentCreatedAt).getTime() : 0;
        const db = b.tournamentCreatedAt ? new Date(b.tournamentCreatedAt).getTime() : 0;
        if (db !== da) return db - da;
        return a.placement - b.placement;
      });
    }
  }

  const trophies = history.filter((h) => h.placement === 1);
  const perfByPlayer = await loadPlayerPerformance([playerId]);
  const perf = perfByPlayer.get(playerId);

  const rankedTier = prestigeTier(Number(player.prestige_points ?? 0));
  const rankedMmr = Number(perf?.effectiveMmr ?? player.mmr ?? 0);
  const rankedPrestigePoints = Math.max(0, Number(player.prestige_points ?? 0));
  const hasFinishedMatch = perf?.hasFinishedMatch ?? false;
  const mmrManualOverride = perf?.mmrManualOverride ?? (player.mmr_manual_override === true);
  const canShowRank = canShowRankFromMmr(hasFinishedMatch, mmrManualOverride);
  const currentRank = displayRankFromProgress(canShowRank, rankedMmr, rankedPrestigePoints);
  const currentRankLabel = rankLabel(currentRank);
  const rankFrameEnabled = player.rank_frame_enabled !== false;
  const profileColor = typeof player.profile_color === "string" ? player.profile_color : null;
  const favoriteBeer = typeof player.favorite_beer === "string" ? player.favorite_beer : null;
  const profileStyle = playerToneStyle(profileColor);
  const profileRankFrameUrl = FRAME_BY_RANK[currentRank] ?? null;
  const historyRes = await supabaseServer
    .from("player_mmr_history")
    .select("mmr,created_at")
    .eq("player_id", playerId)
    .order("created_at", { ascending: true })
    .limit(80);

  let mmrHistoryPoints: MmrPoint[] = [];
  if (!historyRes.error) {
    mmrHistoryPoints = (historyRes.data ?? []).map((row) => ({
      mmr: Number(row.mmr ?? 0),
      createdAt: typeof row.created_at === "string" ? row.created_at : null,
    }));
  }
  const sparkPoints = buildSparkPoints(mmrHistoryPoints);
  const sparkline = sparkPoints.map((point) => `${point.x.toFixed(1)},${point.y.toFixed(1)}`).join(" ");

  return (
    <main className="player-profile-root">
      <div className="profile-topbar">
        <BackNavButton className="underline opacity-80" fallbackHref="/players" />
        <span className="profile-kicker">Profil zawodnika</span>
      </div>

      <section className="player-grid mt-4">
        <article className="profile-card profile-hero player-tone-card" style={profileStyle}>
          <ProfileSettingsButton
            playerId={playerId}
            initialRankFrameEnabled={rankFrameEnabled}
            initialProfileColor={profileColor}
            initialFavoriteBeer={favoriteBeer}
          />
          <div className="profile-hero-top">
            {player.avatar_url ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={player.avatar_url} alt="avatar" className="profile-avatar" />
            ) : (
              <div className="profile-avatar profile-avatar-fallback">{player.name.slice(0, 1).toUpperCase()}</div>
            )}

            <div className="profile-hero-name-block">
              <div className="profile-name-row">
                <h1 className="profile-name">{player.name}</h1>
                {favoriteBeer ? (
                  <span className="profile-favorite-beer" title={`Ulubione piwo: ${favoriteBeer}`}>
                    <BeerCan3D beer={{ name: favoriteBeer }} />
                  </span>
                ) : null}
              </div>
              <p className="profile-muted">{player.active ? "aktywny" : "nieaktywny"}</p>
            </div>
          </div>

          <UploadAvatar playerId={playerId} className="mt-4" />

          <div className="profile-rating-box mt-5">
            <div className="profile-rating-layout">
              <div className="profile-rating-copy">
                <div className="profile-rating-head">
                  <div>
                    <p className="profile-section-title">Rating</p>
                    <div className="profile-rating-row">
                      <span className="profile-rating-value">{rating !== null ? rating.toFixed(1) : "--"}</span>
                      <span className="profile-rating-scale">/10</span>
                    </div>
                    <p className="profile-muted mt-1">Liczba ocen: {ratingValues.length}</p>
                  </div>

                  <div className="profile-mmr-chart">
                    <p className="profile-muted">Historia MMR</p>
                    {sparkline ? (
                      <svg
                        viewBox={`0 0 ${CHART_WIDTH} ${CHART_HEIGHT}`}
                        preserveAspectRatio="none"
                        className="profile-mmr-chart-svg"
                      >
                        <g className="profile-mmr-chart-grid-wrap">
                          {Array.from({ length: 21 }, (_, idx) => {
                            const mmrValue = idx * 0.5;
                            const drawableHeight = CHART_HEIGHT - CHART_PAD_Y * 2;
                            const y = CHART_PAD_Y + drawableHeight - (mmrValue / 10) * drawableHeight;
                            return (
                              <line
                                key={mmrValue}
                                x1={CHART_PAD_X}
                                y1={y}
                                x2={CHART_WIDTH - CHART_PAD_X}
                                y2={y}
                                className="profile-mmr-chart-grid"
                              />
                            );
                          })}
                        </g>
                        <polyline points={sparkline} className="profile-mmr-chart-line" />
                        <g className="profile-mmr-chart-dots">
                          {sparkPoints.map((point, idx) => {
                            const label = `MMR ${point.mmr.toFixed(1)} | ${formatChartTooltipDateTime(point.createdAt)}`;
                            const tooltipW = 126;
                            const tooltipH = 20;
                            const tooltipX = Math.max(
                              2,
                              Math.min(CHART_WIDTH - tooltipW - 2, point.x - tooltipW / 2)
                            );
                            const tooltipY = point.y < 26 ? point.y + 8 : point.y - 24;

                            return (
                              <g key={`${idx}-${point.x}-${point.y}`} className="profile-mmr-chart-point">
                                <circle
                                  cx={point.x}
                                  cy={point.y}
                                  r={idx === sparkPoints.length - 1 ? 3.1 : 2.5}
                                  className="profile-mmr-chart-dot"
                                />
                                <g
                                  className="profile-mmr-chart-tooltip"
                                  transform={`translate(${tooltipX.toFixed(1)},${tooltipY.toFixed(1)})`}
                                >
                                  <rect width={tooltipW} height={tooltipH} rx={6} ry={6} />
                                  <text x={tooltipW / 2} y={14} textAnchor="middle">
                                    {label}
                                  </text>
                                </g>
                              </g>
                            );
                          })}
                        </g>
                      </svg>
                    ) : (
                      <p className="profile-muted">Brak historii ranked.</p>
                    )}
                  </div>
                </div>

                <div className="mt-2 flex items-center gap-2">
                  <span className="profile-rating-chip">MMR {Number.isFinite(rankedMmr) ? rankedMmr.toFixed(1) : "0.0"}</span>
                  <span
                    className="profile-rating-chip"
                    style={{
                      borderColor: prestigeColor(rankedTier),
                    }}
                  >
                    {rankedTier > 0 ? `Prestige +${rankedTier}` : "Prestige 0"}
                  </span>
                  <span className="profile-rating-chip">Ranga: {currentRankLabel}</span>
                </div>
                <p className="profile-muted mt-1">Punkty prestige: {Number.isFinite(rankedPrestigePoints) ? rankedPrestigePoints : 0}</p>
                {ratingsErr && <p className="profile-muted mt-1">Blad ocen: {ratingsErr.message}</p>}
                {membershipsErr && <p className="profile-muted mt-1">Blad historii: {membershipsErr.message}</p>}
              </div>

              <aside className="profile-rank-preview" aria-label="Obramowka rangi">
                {profileRankFrameUrl ? (
                  <span className="profile-rank-preview-wrap">
                    <span
                      className="profile-rank-preview-frame"
                      style={{ backgroundImage: `url('${profileRankFrameUrl}')` }}
                      aria-hidden
                    />
                  </span>
                ) : (
                  <span className="profile-muted">Brak ramki (Unranked)</span>
                )}
              </aside>
            </div>
          </div>
        </article>

        <article className="profile-card profile-trophies">
          <p className="profile-section-title">Wygrane</p>

          {trophies.length === 0 ? (
            <p className="profile-muted mt-3">Brak pucharow.</p>
          ) : (
            <div className="trophy-grid mt-3">
              {trophies.slice(0, 8).map((t, idx) => (
                <div key={`${t.tournamentId}-${idx}`} className="trophy-item">
                  <TrophyIcon seed={`${idx}`} />
                  <p className="trophy-name" title={t.tournamentName}>
                    {t.tournamentName}
                  </p>
                </div>
              ))}
            </div>
          )}
        </article>

        <article className="profile-card profile-history">
          <p className="profile-section-title">Historia gier</p>

          {history.length === 0 ? (
            <p className="profile-muted mt-3">Brak historii turniejowej.</p>
          ) : (
            <div className="history-list mt-3">
              {history.map((h, idx) => (
                <details key={`${h.tournamentId}-${h.teamId}-${idx}`} className="history-row">
                  <summary>
                    <span className="history-date">{formatShortDate(h.tournamentCreatedAt)}</span>
                    <span className="history-place">{formatPlacement(h.placement)}</span>
                    <span className="history-team">{h.teamName}</span>
                    <span className="history-menu">&gt;</span>
                  </summary>

                  <div className="history-expand">
                    <p>
                      Turniej:{" "}
                      <Link className="underline" href={`/tournaments/${h.tournamentId}`}>
                        {h.tournamentName}
                      </Link>
                    </p>
                    <p className="mt-1">Druzyna: {h.teamName}</p>
                    {h.teamRoster.length > 0 && (
                      <p className="mt-1">Sklad: {h.teamRoster.map((p) => p.name).join(", ")}</p>
                    )}
                  </div>
                </details>
              ))}
            </div>
          )}
        </article>

        <article className="profile-card profile-beers">
          <p className="profile-section-title">Wypite piwa</p>
          <p className="profile-beers-value">{beers}</p>
        </article>

        <article className="profile-card profile-rate">
          <RatePlayer playerId={playerId} />
        </article>
      </section>
    </main>
  );
}
