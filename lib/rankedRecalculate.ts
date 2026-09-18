import { supabaseServer } from "@/lib/supabaseServer";
import { trimmedMean } from "@/lib/rating";
import { isOneVsOneFormat } from "@/lib/tournamentFormat";
import { ensureRankedBaselines, inferRankedBaselinesFromHistory, loadRankedBaselines } from "@/lib/rankedBaseline";
import { replayRanked, type RankedEvent } from "@/lib/rankedReplay";
import type { RankedState } from "@/lib/ranked";

type PlayerRow = {
  id: string; mmr: number | null; prestige_points: number | null;
  rating_override: number | null; mmr_manual_override: boolean | null;
};
type TournamentRow = { id: string; format: string; mode: string; created_at: string };
type MatchRow = {
  id: string; tournament_id: string; team_a_id: string | null; team_b_id: string | null;
  winner_team_id: string | null; status: string; created_at: string; updated_at: string | null;
  ranked_finished_at: string | null; round_no: number; match_no: number;
};
type BonusRow = { id: string; player_id: string; delta: number; created_at: string };

// Supabase's default row limit must not silently truncate ranking history.
async function readAll<T>(table: string, columns: string, orderColumns = ["id"], filter?: { column: string; values: string[] }): Promise<T[]> {
  const rows: T[] = [];
  for (let offset = 0; ; offset += 500) {
    let query = supabaseServer.from(table).select(columns);
    if (filter) query = query.in(filter.column, filter.values);
    for (const column of orderColumns) query = query.order(column);
    const result = await query.range(offset, offset + 499);
    if (result.error) throw new Error(`ranked_${table}_read_failed: ${result.error.message}`);
    const page = result.data as T[];
    rows.push(...page);
    if (page.length < 500) return rows;
  }
}

function clampMmr(value: number) {
  return Math.round(Math.min(10, Math.max(0, Number.isFinite(value) ? value : 5)) * 10) / 10;
}

async function recalculateAttempt(targetPlayerId: string | null) {
  const revision = await supabaseServer.from("ranked_replay_revision").select("revision").eq("id", 1).single();
  if (revision.error) throw new Error(`ranked_schema_required: ${revision.error.message}`);
  const [players, tournaments, matches, members, results, bonuses, ratings, manualHistory] = await Promise.all([
    readAll<PlayerRow>("players", "id,mmr,prestige_points,rating_override,mmr_manual_override"),
    readAll<TournamentRow>("tournaments", "id,format,mode,created_at"),
    readAll<MatchRow>("tournament_matches", "id,tournament_id,team_a_id,team_b_id,winner_team_id,status,created_at,updated_at,ranked_finished_at,round_no,match_no"),
    readAll<{ team_id: string; player_id: string }>("team_members", "team_id,player_id", ["team_id", "player_id"]),
    readAll<{ tournament_id: string; team_id: string; placement: number }>("tournament_results", "tournament_id,team_id,placement", ["tournament_id", "placement", "team_id"]),
    readAll<BonusRow>("player_performance_bonuses", "id,player_id,delta,created_at"),
    readAll<{ rated_player_id: string; value: number }>("ratings", "rated_player_id,value"),
    readAll<{ id: string; player_id: string; reason: string; mmr: number; prestige_points: number; created_at: string }>(
      "player_mmr_history", "id,player_id,reason,mmr,prestige_points,created_at", ["id"],
      { column: "reason", values: ["admin_set_mmr", "admin_reset_mmr"] }),
  ]);
  if (targetPlayerId && !players.some((p) => p.id === targetPlayerId)) throw new Error("player_not_found");
  const ranked = new Map(tournaments.filter((t) => t.mode === "ranked").map((t) => [t.id, t]));
  const teamPlayers = new Map<string, string[]>();
  for (const member of members) {
    teamPlayers.set(member.team_id, [...(teamPlayers.get(member.team_id) ?? []), member.player_id]);
  }
  const events: RankedEvent[] = [];
  const lastMatch = new Map<string, string>();
  for (const match of matches) {
    const tournament = ranked.get(match.tournament_id);
    if (!tournament || match.status !== "finished" || !match.team_a_id || !match.team_b_id ||
      !match.winner_team_id || ![match.team_a_id, match.team_b_id].includes(match.winner_team_id)) continue;
    const at = match.ranked_finished_at ?? match.updated_at ?? match.created_at ?? tournament.created_at;
    const loser = match.winner_team_id === match.team_a_id ? match.team_b_id : match.team_a_id;
    events.push({
      kind: "match", id: match.id, at, tournamentId: tournament.id,
      winners: teamPlayers.get(match.winner_team_id) ?? [], losers: teamPlayers.get(loser) ?? [],
      oneVsOne: isOneVsOneFormat(tournament.format), order: (match.round_no ?? 0) * 10000 + (match.match_no ?? 0),
    });
    if (!lastMatch.has(tournament.id) || Date.parse(at) > Date.parse(lastMatch.get(tournament.id)!)) {
      lastMatch.set(tournament.id, at);
    }
  }
  for (const result of results) {
    const tournament = ranked.get(result.tournament_id);
    const at = lastMatch.get(result.tournament_id);
    if (!tournament || !at || result.placement !== 1 || isOneVsOneFormat(tournament.format)) continue;
    events.push({ kind: "champion", id: tournament.id, at, tournamentId: tournament.id, players: teamPlayers.get(result.team_id) ?? [] });
  }
  for (const bonus of bonuses) {
    events.push({ kind: "performance", id: bonus.id, at: bonus.created_at, playerId: bonus.player_id, delta: Number(bonus.delta) });
  }
  for (const row of manualHistory) {
    if (row.reason !== "admin_set_mmr" && row.reason !== "admin_reset_mmr") continue;
    events.push({ kind: "manual", id: row.id, at: row.created_at, playerId: row.player_id,
      state: { mmr: clampMmr(Number(row.mmr)), prestigePoints: Math.max(0, Number(row.prestige_points ?? 0)) } });
  }

  const playerIds = players.map((p) => p.id);
  const saved = await loadRankedBaselines(playerIds);
  const inferred = await inferRankedBaselinesFromHistory(playerIds.filter((id) => !saved.has(id)));
  const ratingsByPlayer = new Map<string, number[]>();
  for (const rating of ratings) {
    ratingsByPlayer.set(rating.rated_player_id, [...(ratingsByPlayer.get(rating.rated_player_id) ?? []), Number(rating.value)]);
  }
  const affected = new Set(saved.keys()); // Includes players whose last tournament was reset/deleted.
  for (const event of events) {
    const ids = event.kind === "performance" || event.kind === "manual" ? [event.playerId] : event.kind === "champion" ? event.players : [...event.winners, ...event.losers];
    ids.forEach((id) => affected.add(id));
  }
  if (targetPlayerId) affected.add(targetPlayerId);
  const baselines = players.map((player) => saved.get(player.id) ?? inferred.get(player.id) ?? {
    playerId: player.id,
    mmr: player.mmr_manual_override ? clampMmr(Number(player.mmr ?? 0)) :
      clampMmr(player.rating_override ?? trimmedMean(ratingsByPlayer.get(player.id) ?? []) ?? 5),
    prestigePoints: player.mmr_manual_override ? Math.max(0, Math.floor(Number(player.prestige_points ?? 0))) : 0,
    source: player.mmr_manual_override ? "manual_override" : "current_rating_fallback",
  });
  const persist = (id: string) => affected.has(id) && (!targetPlayerId || id === targetPlayerId);
  const requiredBaselines = baselines.filter((b) => persist(b.playerId));
  const stored = await ensureRankedBaselines(requiredBaselines);
  if (requiredBaselines.some((b) => !stored.has(b.playerId))) throw new Error("ranked_baseline_schema_required");
  const initial = new Map<string, RankedState>(baselines.map((b) => [b.playerId, { mmr: b.mmr, prestigePoints: b.prestigePoints }]));
  const replay = replayRanked(initial, events);
  const updates = Array.from(replay.states).filter(([id]) => persist(id)).map(([id, state]) => ({
    id, mmr: state.mmr, prestige_points: state.prestigePoints,
    ranked_win_streak: replay.streaks.get(id)?.wins ?? 0,
    ranked_duel_wins: replay.streaks.get(id)?.duelWins ?? 0,
  }));
  const history = replay.history.filter((row) => persist(row.player_id));
  // History and player totals commit together; retry if a result or bonus arrived during replay.
  const commit = await supabaseServer.rpc("persist_ranked_replay", {
    expected_revision: revision.data.revision, player_updates: updates, history_rows: history,
  });
  if (commit.error) throw new Error(`ranked_commit_failed: ${commit.error.message}`);
  if (commit.data !== true) return null;
  return {
    playersUpdated: updates.length, historyRows: history.length, eventsApplied: history.length,
    rankedTournaments: ranked.size, ...(targetPlayerId ? { playerId: targetPlayerId } : {}),
  };
}

export async function recalculateRankedMmr(options: { playerId?: string } = {}) {
  for (let attempt = 0; attempt < 3; attempt++) {
    const result = await recalculateAttempt(options.playerId?.trim() || null);
    if (result) return result;
  }
  throw new Error("ranked_results_changed_retry");
}

export async function recalculateRankedMmrForPlayer(playerId: string) {
  return recalculateRankedMmr({ playerId });
}
