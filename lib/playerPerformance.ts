import { supabaseServer } from "@/lib/supabaseServer";
import { trimmedMean } from "@/lib/rating";
import { BASE_MMR_CAP } from "@/lib/ranked";

export type PlayerPerformance = {
  playerId: string;
  rating: number;
  storedMmr: number;
  prestigePoints: number;
  hasFinishedMatch: boolean;
  mmrManualOverride: boolean;
  effectiveMmr: number;
};

type LoadPlayerPerformanceOptions = {
  excludeMatchId?: string;
};

function roundToOne(value: number): number {
  return Math.round((value + Number.EPSILON) * 10) / 10;
}

function clampToMmrRange(value: number): number {
  if (!Number.isFinite(value)) return 0;
  if (value < 0) return 0;
  if (value > BASE_MMR_CAP) return BASE_MMR_CAP;
  return roundToOne(value);
}

function fallbackRating(value: number | null): number {
  if (value === null || !Number.isFinite(value)) return 5;
  return clampToMmrRange(value);
}

export async function loadPlayerPerformance(
  playerIds: string[],
  options?: LoadPlayerPerformanceOptions
): Promise<Map<string, PlayerPerformance>> {
  const ids = Array.from(new Set(playerIds.filter(Boolean)));
  const result = new Map<string, PlayerPerformance>();
  if (ids.length === 0) return result;

  const [playersPrimary, ratingsResult] = await Promise.all([
    supabaseServer
      .from("players")
      .select("id,mmr,prestige_points,rating_override,mmr_manual_override")
      .in("id", ids),
    supabaseServer.from("ratings").select("rated_player_id,value").in("rated_player_id", ids),
  ]);

  let playerRows = playersPrimary.data as
    | Array<{
        id: string;
        mmr: number | null;
        prestige_points: number | null;
        rating_override?: number | null;
        mmr_manual_override?: boolean | null;
      }>
    | null;
  let playerErr = playersPrimary.error;

  const ratingsRows = ratingsResult.data;
  const ratingsErr = ratingsResult.error;

  if (
    playerErr &&
    (playerErr.message.includes("mmr_manual_override") || playerErr.message.includes("rating_override"))
  ) {
    const playersRetry = await supabaseServer
      .from("players")
      .select("id,mmr,prestige_points")
      .in("id", ids);

    playerRows = (playersRetry.data ?? []).map((row) => ({
      id: String(row.id),
      mmr: Number(row.mmr ?? 0),
      prestige_points: Number(row.prestige_points ?? 0),
      rating_override: null,
      mmr_manual_override: false,
    }));
    playerErr = playersRetry.error;
  }

  if (playerErr) throw new Error(`player_performance_players_failed: ${playerErr.message}`);
  if (ratingsErr) throw new Error(`player_performance_ratings_failed: ${ratingsErr.message}`);

  const ratingsGrouped = new Map<string, number[]>();
  for (const row of ratingsRows ?? []) {
    const playerId = typeof row.rated_player_id === "string" ? row.rated_player_id : "";
    const value = Number(row.value);
    if (!playerId || !Number.isFinite(value)) continue;
    const current = ratingsGrouped.get(playerId) ?? [];
    current.push(value);
    ratingsGrouped.set(playerId, current);
  }

  const ratingByPlayer = new Map<string, number>();
  for (const playerId of ids) {
    const playerOverride = (playerRows ?? []).find((row) => row.id === playerId) as
      | { rating_override?: number | null }
      | undefined;
    const override = Number(playerOverride?.rating_override);
    const rating = trimmedMean(ratingsGrouped.get(playerId) ?? []);
    ratingByPlayer.set(playerId, fallbackRating(Number.isFinite(override) ? override : rating));
  }

  const { data: memberships, error: membershipsErr } = await supabaseServer
    .from("team_members")
    .select("player_id,team_id")
    .in("player_id", ids);

  if (membershipsErr) {
    throw new Error(`player_performance_memberships_failed: ${membershipsErr.message}`);
  }

  const teamsByPlayer = new Map<string, string[]>();
  const allTeamIds = new Set<string>();
  for (const row of memberships ?? []) {
    const playerId = typeof row.player_id === "string" ? row.player_id : "";
    const teamId = typeof row.team_id === "string" ? row.team_id : "";
    if (!playerId || !teamId) continue;
    const current = teamsByPlayer.get(playerId) ?? [];
    current.push(teamId);
    teamsByPlayer.set(playerId, current);
    allTeamIds.add(teamId);
  }

  const playedTeamIds = new Set<string>();
  const teamIds = Array.from(allTeamIds);
  if (teamIds.length > 0) {
    let matchesQuery = supabaseServer
      .from("tournament_matches")
      .select("team_a_id,team_b_id")
      .eq("status", "finished")
      .or(`team_a_id.in.(${teamIds.join(",")}),team_b_id.in.(${teamIds.join(",")})`);

    if (options?.excludeMatchId) {
      matchesQuery = matchesQuery.neq("id", options.excludeMatchId);
    }

    const { data: matches, error: matchesErr } = await matchesQuery;
    if (matchesErr) throw new Error(`player_performance_matches_failed: ${matchesErr.message}`);

    for (const row of matches ?? []) {
      if (typeof row.team_a_id === "string" && row.team_a_id) playedTeamIds.add(row.team_a_id);
      if (typeof row.team_b_id === "string" && row.team_b_id) playedTeamIds.add(row.team_b_id);
    }
  }

  const playersMap = new Map<
    string,
    { mmr: number; prestigePoints: number; mmrManualOverride: boolean }
  >();
  for (const row of playerRows ?? []) {
    const playerId = typeof row.id === "string" ? row.id : "";
    if (!playerId) continue;
    playersMap.set(playerId, {
      mmr: clampToMmrRange(Number(row.mmr ?? 0)),
      prestigePoints: Math.max(0, Math.floor(Number(row.prestige_points ?? 0))),
      mmrManualOverride: row.mmr_manual_override === true,
    });
  }

  for (const playerId of ids) {
    const teams = teamsByPlayer.get(playerId) ?? [];
    const hasFinishedMatch = teams.some((teamId) => playedTeamIds.has(teamId));
    const rating = ratingByPlayer.get(playerId) ?? 5;
    const row = playersMap.get(playerId) ?? {
      mmr: 0,
      prestigePoints: 0,
      mmrManualOverride: false,
    };
    const rankAllowed = hasFinishedMatch || row.mmrManualOverride;

    result.set(playerId, {
      playerId,
      rating,
      storedMmr: row.mmr,
      prestigePoints: row.prestigePoints,
      hasFinishedMatch,
      mmrManualOverride: row.mmrManualOverride,
      effectiveMmr: rankAllowed ? row.mmr : rating,
    });
  }

  return result;
}
