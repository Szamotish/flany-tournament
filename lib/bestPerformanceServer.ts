import { supabaseServer } from "@/lib/supabaseServer";
import { loadPlayerPerformance } from "@/lib/playerPerformance";
import { canShowRankFromMmr, displayRankFromProgress } from "@/lib/playerRank";
import { performanceMarkers, scoreBestPerformance, selectPerformanceWindow, type BestPerformanceData,
  type PerformanceTournament, type PerformanceResult, type PerformanceMatch, type PerformanceMember } from "@/lib/bestPerformance";

async function readPages<T>(table: string, columns: string, order: string[], filter?: { column: string; values: string[] }): Promise<T[]> {
  const rows: T[] = [];
  for (let offset = 0; ; offset += 500) {
    let query = supabaseServer.from(table).select(columns);
    if (filter) query = query.in(filter.column, filter.values);
    if (table === "tournaments") query = query.eq("mode", "ranked").eq("tournament_results.placement", 1);
    for (const column of order) query = query.order(column);
    const { data, error } = await query.range(offset, offset + 499).abortSignal(AbortSignal.timeout(8000));
    if (error) throw new Error(`best_performance_${table}_unavailable`);
    rows.push(...data as T[]);
    if (data.length < 500) return rows;
  }
}

export async function readBestPerformance(): Promise<BestPerformanceData> {
  // Only completed ranked tournaments; selection by the actual event date is
  // done after pagination so a later backfill cannot displace newer games.
  const tournaments = await readPages<PerformanceTournament & { tournament_results: PerformanceResult[] }>("tournaments",
    "id,name,mode,format,event_at,started_at,created_at,is_private,name_day_number,tournament_results!inner(tournament_id,team_id,placement)", ["id"]);
  const results = tournaments.flatMap(t => t.tournament_results);
  const window = selectPerformanceWindow(tournaments, results);
  if (!window.length) return { tournaments: [], leaders: [] };
  const ids = window.map(t => t.id);
  const matches = await readPages<PerformanceMatch>("tournament_matches", "id,tournament_id,team_a_id,team_b_id,status", ["id"], { column: "tournament_id", values: ids });
  const teamIds = [...new Set([...matches.flatMap(m => [m.team_a_id, m.team_b_id]), ...results.filter(r => ids.includes(r.tournament_id)).map(r => r.team_id)]
    .filter((id): id is string => !!id))];
  const members: PerformanceMember[] = [];
  for (let offset = 0; offset < teamIds.length; offset += 100) {
    members.push(...await readPages<PerformanceMember>("team_members", "team_id,player_id", ["team_id", "player_id"], { column: "team_id", values: teamIds.slice(offset, offset + 100) }));
  }
  const scores = scoreBestPerformance(window, results, matches, members);
  if (!scores.length) return { tournaments: performanceMarkers(window), leaders: [] };
  const playerIds = scores.map(s => s.playerId);
  const players: { id: string; name: string; avatar_url: string | null }[] = [];
  for (let offset = 0; offset < playerIds.length; offset += 100) {
    players.push(...await readPages<{ id: string; name: string; avatar_url: string | null }>("players", "id,name,avatar_url", ["id"], { column: "id", values: playerIds.slice(offset, offset + 100) }));
  }
  const performance = await loadPlayerPerformance(playerIds);
  const leaders = players.map(player => {
    const perf = performance.get(player.id);
    if (!perf) throw new Error("best_performance_rank_unavailable");
    return { ...scores.find(s => s.playerId === player.id)!, name: player.name, avatarUrl: player.avatar_url,
      rank: displayRankFromProgress(canShowRankFromMmr(perf.hasFinishedMatch, perf.mmrManualOverride), perf.effectiveMmr, perf.prestigePoints) };
  }).sort((a, b) => a.name.localeCompare(b.name, "pl") || a.playerId.localeCompare(b.playerId));
  return { tournaments: performanceMarkers(window), leaders };
}
