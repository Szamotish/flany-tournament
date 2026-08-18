import { supabaseServer } from "@/lib/supabaseServer";
import { trimmedMean } from "@/lib/rating";
import {
  applyRankedDelta,
  PRESTIGE_POINTS_PER_MMR,
  RANKED_MATCH_LOSS_DELTA,
  RANKED_MATCH_WIN_DELTA,
  RANKED_TOURNAMENT_WIN_BONUS,
} from "@/lib/ranked";
import { isOneVsOneFormat } from "@/lib/tournamentFormat";
import {
  ensureRankedBaselines,
  inferRankedBaselinesFromHistory,
  loadRankedBaselines,
} from "@/lib/rankedBaseline";

const ONE_V_ONE_BASE_WIN_DELTA = 0.1;
const ONE_V_ONE_BASE_LOSS_DELTA = -0.1;
const ONE_V_ONE_UPSET_WIN_DELTA = 0.2;
const ONE_V_ONE_UPSET_LOSS_DELTA = -0.2;
const ONE_V_ONE_FAVORED_WIN_DELTA = 0;
const ONE_V_ONE_RANKED_SCORE_DIFF_THRESHOLD = 2.5;

type PlayerRow = {
  id: string;
  mmr: number | null;
  prestige_points: number | null;
  rating_override?: number | null;
  mmr_manual_override?: boolean | null;
};

type TournamentRow = {
  id: string;
  format: string | null;
  created_at: string | null;
};

type MatchRow = {
  id: string;
  tournament_id: string;
  team_a_id: string | null;
  team_b_id: string | null;
  winner_team_id: string | null;
  created_at?: string | null;
  updated_at?: string | null;
  round_no?: number | null;
  match_no?: number | null;
};

type RankedMatchEvent = {
  sortAt: string;
  sortKind: 0;
  tournamentId: string;
  matchId: string;
  winnerTeamId: string;
  loserTeamId: string;
  oneVsOne: boolean;
};

type RankedBonusEvent = {
  sortAt: string;
  sortKind: 1;
  tournamentId: string;
  matchId: null;
  teamId: string;
  delta: number;
  reason: "tournament_win";
};

type RankedEvent = RankedMatchEvent | RankedBonusEvent;

function roundToOne(value: number): number {
  return Math.round((value + Number.EPSILON) * 10) / 10;
}

function clampRating(value: number | null): number {
  if (value === null || !Number.isFinite(value)) return 5;
  if (value < 0) return 0;
  if (value > 10) return 10;
  return roundToOne(value);
}

function chunk<T>(values: T[], size = 500): T[][] {
  const chunks: T[][] = [];
  for (let index = 0; index < values.length; index += size) {
    chunks.push(values.slice(index, index + size));
  }
  return chunks;
}

function eventDate(match: MatchRow, tournament: TournamentRow | undefined): string {
  return match.updated_at ?? match.created_at ?? tournament?.created_at ?? new Date(0).toISOString();
}

function rankedScore(state: { mmr: number; prestigePoints: number } | undefined): number {
  if (!state) return 5;
  return Number(state.mmr) + Number(state.prestigePoints) / PRESTIGE_POINTS_PER_MMR;
}

function averageTeamRankedScore(
  teamId: string,
  teamPlayersByTeam: Map<string, string[]>,
  stateByPlayer: Map<string, { mmr: number; prestigePoints: number }>
): number {
  const players = teamPlayersByTeam.get(teamId) ?? [];
  if (players.length === 0) return 5;

  let sum = 0;
  let count = 0;
  for (const playerId of players) {
    const score = rankedScore(stateByPlayer.get(playerId));
    if (!Number.isFinite(score)) continue;
    sum += score;
    count += 1;
  }

  return count > 0 ? sum / count : 5;
}

function oneVsOneDeltas(
  winnerTeamId: string,
  loserTeamId: string,
  teamPlayersByTeam: Map<string, string[]>,
  stateByPlayer: Map<string, { mmr: number; prestigePoints: number }>
): { winnerDelta: number; loserDelta: number } {
  const winnerRankedScore = averageTeamRankedScore(winnerTeamId, teamPlayersByTeam, stateByPlayer);
  const loserRankedScore = averageTeamRankedScore(loserTeamId, teamPlayersByTeam, stateByPlayer);
  const winnerHigherRanked = winnerRankedScore >= loserRankedScore;
  const rankedScoreDiff = Math.abs(winnerRankedScore - loserRankedScore);

  if (rankedScoreDiff <= ONE_V_ONE_RANKED_SCORE_DIFF_THRESHOLD) {
    return { winnerDelta: ONE_V_ONE_BASE_WIN_DELTA, loserDelta: ONE_V_ONE_BASE_LOSS_DELTA };
  }

  if (winnerHigherRanked) {
    return { winnerDelta: ONE_V_ONE_FAVORED_WIN_DELTA, loserDelta: ONE_V_ONE_BASE_LOSS_DELTA };
  }

  return { winnerDelta: ONE_V_ONE_UPSET_WIN_DELTA, loserDelta: ONE_V_ONE_UPSET_LOSS_DELTA };
}

export async function recalculateRankedMmr(): Promise<{
  playersUpdated: number;
  historyRows: number;
  eventsApplied: number;
  rankedTournaments: number;
}> {
  const tournamentsRes = await supabaseServer
    .from("tournaments")
    .select("id,format,created_at")
    .eq("mode", "ranked");

  if (tournamentsRes.error) throw new Error(`ranked_tournaments_failed: ${tournamentsRes.error.message}`);

  const tournaments = (tournamentsRes.data ?? []) as TournamentRow[];
  const tournamentIds = tournaments.map((row) => row.id).filter(Boolean);
  if (tournamentIds.length === 0) {
    return { playersUpdated: 0, historyRows: 0, eventsApplied: 0, rankedTournaments: 0 };
  }

  const tournamentById = new Map(tournaments.map((row) => [row.id, row]));

  const matchesPrimary = await supabaseServer
    .from("tournament_matches")
    .select("id,tournament_id,team_a_id,team_b_id,winner_team_id,created_at,updated_at,round_no,match_no")
    .eq("status", "finished")
    .in("tournament_id", tournamentIds);

  let matches = matchesPrimary.data as MatchRow[] | null;
  if (matchesPrimary.error && matchesPrimary.error.message.includes("updated_at")) {
    const fallback = await supabaseServer
      .from("tournament_matches")
      .select("id,tournament_id,team_a_id,team_b_id,winner_team_id,created_at,round_no,match_no")
      .eq("status", "finished")
      .in("tournament_id", tournamentIds);
    if (fallback.error) throw new Error(`ranked_matches_failed: ${fallback.error.message}`);
    matches = fallback.data as MatchRow[] | null;
  } else if (matchesPrimary.error) {
    throw new Error(`ranked_matches_failed: ${matchesPrimary.error.message}`);
  }

  const finishedMatches = (matches ?? []).filter((match) => match.team_a_id && match.team_b_id && match.winner_team_id);
  const teamIds = Array.from(
    new Set(finishedMatches.flatMap((match) => [match.team_a_id, match.team_b_id]).filter((id): id is string => Boolean(id)))
  );

  const teamPlayersByTeam = new Map<string, string[]>();
  const playerIdsSet = new Set<string>();
  if (teamIds.length > 0) {
    for (const ids of chunk(teamIds)) {
      const { data, error } = await supabaseServer
        .from("team_members")
        .select("team_id,player_id")
        .in("team_id", ids);

      if (error) throw new Error(`ranked_team_members_failed: ${error.message}`);

      for (const row of data ?? []) {
        const teamId = String(row.team_id ?? "");
        const playerId = String(row.player_id ?? "");
        if (!teamId || !playerId) continue;
        const current = teamPlayersByTeam.get(teamId) ?? [];
        current.push(playerId);
        teamPlayersByTeam.set(teamId, current);
        playerIdsSet.add(playerId);
      }
    }
  }

  const playerIds = Array.from(playerIdsSet);
  if (playerIds.length === 0) {
    return { playersUpdated: 0, historyRows: 0, eventsApplied: 0, rankedTournaments: tournamentIds.length };
  }

  const playerRows: PlayerRow[] = [];
  for (const ids of chunk(playerIds)) {
    const primary = await supabaseServer
      .from("players")
      .select("id,mmr,prestige_points,rating_override,mmr_manual_override")
      .in("id", ids);

    if (
      primary.error &&
      (primary.error.message.includes("rating_override") || primary.error.message.includes("mmr_manual_override"))
    ) {
      const fallback = await supabaseServer
        .from("players")
        .select("id,mmr,prestige_points")
        .in("id", ids);
      if (fallback.error) throw new Error(`ranked_players_failed: ${fallback.error.message}`);
      playerRows.push(
        ...((fallback.data ?? []) as Array<{ id: string; mmr: number | null; prestige_points: number | null }>).map((row) => ({
          ...row,
          rating_override: null,
          mmr_manual_override: false,
        }))
      );
    } else if (primary.error) {
      throw new Error(`ranked_players_failed: ${primary.error.message}`);
    } else {
      playerRows.push(...((primary.data ?? []) as PlayerRow[]));
    }
  }

  const ratingsByPlayer = new Map<string, number[]>();
  for (const ids of chunk(playerIds)) {
    const { data, error } = await supabaseServer
      .from("ratings")
      .select("rated_player_id,value")
      .in("rated_player_id", ids);

    if (error) throw new Error(`ranked_ratings_failed: ${error.message}`);

    for (const row of data ?? []) {
      const playerId = String(row.rated_player_id ?? "");
      const value = Number(row.value);
      if (!playerId || !Number.isFinite(value)) continue;
      const current = ratingsByPlayer.get(playerId) ?? [];
      current.push(value);
      ratingsByPlayer.set(playerId, current);
    }
  }

  const savedBaselines = await loadRankedBaselines(playerIds);
  const inferredBaselines = await inferRankedBaselinesFromHistory(
    playerIds.filter((playerId) => !savedBaselines.has(playerId))
  );
  const baselineCandidates: Array<{
    playerId: string;
    mmr: number;
    prestigePoints: number;
    source: string;
  }> = [];

  const stateByPlayer = new Map<string, { mmr: number; prestigePoints: number }>();
  for (const row of playerRows) {
    const overrideRaw = row.rating_override;
    const override = Number(overrideRaw);
    const rating = clampRating(
      overrideRaw !== null && overrideRaw !== undefined && Number.isFinite(override)
        ? override
        : trimmedMean(ratingsByPlayer.get(row.id) ?? [])
    );
    const fallbackBaseline = {
      playerId: row.id,
      mmr: row.mmr_manual_override === true ? clampRating(Number(row.mmr ?? 0)) : rating,
      prestigePoints: row.mmr_manual_override === true ? Math.max(0, Math.floor(Number(row.prestige_points ?? 0))) : 0,
      source: row.mmr_manual_override === true ? "manual_override" : "current_rating_fallback",
    };
    const baseline = savedBaselines.get(row.id) ?? inferredBaselines.get(row.id) ?? fallbackBaseline;
    if (!savedBaselines.has(row.id)) {
      baselineCandidates.push(baseline);
    }
    stateByPlayer.set(row.id, {
      mmr: baseline.mmr,
      prestigePoints: baseline.prestigePoints,
    });
  }

  if (baselineCandidates.length > 0) {
    await ensureRankedBaselines(baselineCandidates);
  }

  const events: RankedEvent[] = [];
  for (const match of finishedMatches) {
    const teamAId = String(match.team_a_id);
    const teamBId = String(match.team_b_id);
    const winnerTeamId = String(match.winner_team_id);
    const loserTeamId = winnerTeamId === teamAId ? teamBId : teamAId;
    const tournament = tournamentById.get(match.tournament_id);
    if (!tournament || !teamPlayersByTeam.has(winnerTeamId) || !teamPlayersByTeam.has(loserTeamId)) continue;

    const sortAt = eventDate(match, tournament);
    events.push({
      sortAt,
      sortKind: 0,
      tournamentId: match.tournament_id,
      matchId: match.id,
      winnerTeamId,
      loserTeamId,
      oneVsOne: isOneVsOneFormat(tournament.format),
    });
  }

  const resultsRes = await supabaseServer
    .from("tournament_results")
    .select("tournament_id,team_id,placement")
    .eq("placement", 1)
    .in("tournament_id", tournamentIds);

  if (resultsRes.error) throw new Error(`ranked_results_failed: ${resultsRes.error.message}`);

  const lastMatchAtByTournament = new Map<string, string>();
  for (const match of finishedMatches) {
    const current = lastMatchAtByTournament.get(match.tournament_id) ?? "";
    const next = eventDate(match, tournamentById.get(match.tournament_id));
    if (!current || next > current) lastMatchAtByTournament.set(match.tournament_id, next);
  }

  for (const row of resultsRes.data ?? []) {
    const tournamentId = String(row.tournament_id ?? "");
    const teamId = String(row.team_id ?? "");
    const tournament = tournamentById.get(tournamentId);
    if (!tournament || !teamId || isOneVsOneFormat(tournament.format) || !teamPlayersByTeam.has(teamId)) continue;
    events.push({
      sortAt: lastMatchAtByTournament.get(tournamentId) ?? tournament.created_at ?? new Date(0).toISOString(),
      sortKind: 1,
      tournamentId,
      matchId: null,
      teamId,
      delta: RANKED_TOURNAMENT_WIN_BONUS,
      reason: "tournament_win",
    });
  }

  events.sort((a, b) => {
    const dateCmp = a.sortAt.localeCompare(b.sortAt);
    if (dateCmp !== 0) return dateCmp;
    if (a.sortKind !== b.sortKind) return a.sortKind - b.sortKind;
    const aKey = a.sortKind === 0
      ? `${a.tournamentId}:${a.matchId}:match:${a.winnerTeamId}:${a.loserTeamId}`
      : `${a.tournamentId}:${a.matchId ?? ""}:${a.reason}:${a.teamId}`;
    const bKey = b.sortKind === 0
      ? `${b.tournamentId}:${b.matchId}:match:${b.winnerTeamId}:${b.loserTeamId}`
      : `${b.tournamentId}:${b.matchId ?? ""}:${b.reason}:${b.teamId}`;
    return aKey.localeCompare(bKey);
  });

  const historyRows: Array<{
    player_id: string;
    tournament_id: string;
    match_id: string | null;
    created_at: string;
    reason: "match_win" | "match_loss" | "tournament_win";
    delta: number;
    mmr: number;
    prestige_points: number;
  }> = [];
  const touchedPlayerIds = new Set<string>();

  for (const event of events) {
    if (event.sortKind === 0) {
      const deltas = event.oneVsOne
        ? oneVsOneDeltas(event.winnerTeamId, event.loserTeamId, teamPlayersByTeam, stateByPlayer)
        : { winnerDelta: RANKED_MATCH_WIN_DELTA, loserDelta: RANKED_MATCH_LOSS_DELTA };
      const matchDeltas = [
        { teamId: event.winnerTeamId, delta: deltas.winnerDelta, reason: "match_win" as const },
        { teamId: event.loserTeamId, delta: deltas.loserDelta, reason: "match_loss" as const },
      ];

      for (const matchDelta of matchDeltas) {
        const eventPlayerIds = teamPlayersByTeam.get(matchDelta.teamId) ?? [];
        for (const playerId of eventPlayerIds) {
          const current = stateByPlayer.get(playerId);
          if (!current) continue;
          const next = applyRankedDelta(current, matchDelta.delta);
          stateByPlayer.set(playerId, next);
          touchedPlayerIds.add(playerId);
          historyRows.push({
            player_id: playerId,
            tournament_id: event.tournamentId,
            match_id: event.matchId,
            created_at: event.sortAt,
            reason: matchDelta.reason,
            delta: matchDelta.delta,
            mmr: next.mmr,
            prestige_points: next.prestigePoints,
          });
        }
      }
      continue;
    }

    const eventPlayerIds = teamPlayersByTeam.get(event.teamId) ?? [];
    for (const playerId of eventPlayerIds) {
      const current = stateByPlayer.get(playerId);
      if (!current) continue;
      const next = applyRankedDelta(current, event.delta);
      stateByPlayer.set(playerId, next);
      touchedPlayerIds.add(playerId);
      historyRows.push({
        player_id: playerId,
        tournament_id: event.tournamentId,
        match_id: event.matchId,
        created_at: event.sortAt,
        reason: event.reason,
        delta: event.delta,
        mmr: next.mmr,
        prestige_points: next.prestigePoints,
      });
    }
  }

  const touchedIds = Array.from(touchedPlayerIds);
  if (touchedIds.length > 0) {
    const deleteHistory = await supabaseServer
      .from("player_mmr_history")
      .delete()
      .in("player_id", touchedIds)
      .in("reason", ["match_win", "match_loss", "tournament_win"]);

    if (deleteHistory.error) throw new Error(`ranked_history_delete_failed: ${deleteHistory.error.message}`);
  }

  for (const rows of chunk(historyRows, 500)) {
    const { error } = await supabaseServer.from("player_mmr_history").insert(rows);
    if (error) throw new Error(`ranked_history_insert_failed: ${error.message}`);
  }

  const updates = touchedIds.map((playerId) => {
    const state = stateByPlayer.get(playerId) ?? { mmr: 0, prestigePoints: 0 };
    return {
      id: playerId,
      mmr: state.mmr,
      prestige_points: state.prestigePoints,
    };
  });

  for (const row of updates) {
    const { error } = await supabaseServer
      .from("players")
      .update({
        mmr: row.mmr,
        prestige_points: row.prestige_points,
      })
      .eq("id", row.id);

    if (error) throw new Error(`ranked_players_update_failed: ${error.message}`);
  }

  return {
    playersUpdated: updates.length,
    historyRows: historyRows.length,
    eventsApplied: events.length,
    rankedTournaments: tournamentIds.length,
  };
}
