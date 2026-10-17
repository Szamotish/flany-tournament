import { supabaseServer } from "./supabaseServer";
import { type StatsSnapshot, playerStats, recentStatsAwards } from "./matchStats";
import { loadPlayerPerformance } from "./playerPerformance";
import { canShowRankFromMmr, displayRankFromProgress } from "./playerRank";

// Shared read-only snapshot; edits/results become visible within a minute.
let cached: { expires: number; value: StatsSnapshot } | null = null;
let pending: Promise<StatsSnapshot> | null = null;
async function rows<T>(table: string, columns: string, cap: number): Promise<T[]> {
  const result: T[] = [];
  for (let offset = 0; ; offset += 250) {
    const { data, error } = await supabaseServer.from(table).select(columns).order(table === "match_notebooks" ? "match_id" : table === "team_members" ? "team_id" : "id")
      .order(table === "match_notebooks" ? "game_no" : table === "team_members" ? "player_id" : "id")
      .range(offset, offset + 249).abortSignal(AbortSignal.timeout(8000));
    if (error || !data || result.length + data.length > cap) throw new Error("match_stats_unavailable");
    result.push(...data as T[]);
    if (data.length < 250) return result;
  }
}
export async function readMatchStatsSnapshot(): Promise<StatsSnapshot> {
  if (cached && cached.expires > Date.now()) return cached.value;
  if (!pending) pending = (async () => {
    const [tournaments, matches, notebooks, members, players] = await Promise.all([
      rows<StatsSnapshot["tournaments"][number]>("tournaments", "id,name,mode,is_private,event_at,started_at,created_at,name_day_number,tournament_results(placement)", 5000),
      rows<StatsSnapshot["matches"][number]>("tournament_matches", "id,tournament_id,status,team_a_id,team_b_id,score_a,score_b,round_no,match_no,bracket,created_at", 15000),
      rows<StatsSnapshot["notebooks"][number]>("match_notebooks", "match_id,tournament_id,game_no,document,roster", 5000),
      rows<StatsSnapshot["members"][number]>("team_members", "player_id,team_id", 15000),
      rows<StatsSnapshot["players"][number]>("players", "id,name,avatar_url", 1000),
    ]);
    const value = { tournaments, matches, notebooks, members, players };
    cached = { expires: Date.now() + 60000, value }; return value;
  })().finally(() => { pending = null; });
  return pending;
}
export async function readPlayerMatchStats(id: string) { return playerStats(await readMatchStatsSnapshot(), id); }
export async function readHomeMatchStats() {
  const data = recentStatsAwards(await readMatchStatsSnapshot());
  const ids = [...new Set(data.awards.flatMap(a => a.leaders.map(p => p.playerId)))];
  const performance = ids.length ? await loadPlayerPerformance(ids) : new Map();
  return { ...data, awards: data.awards.map(a => ({ ...a, leaders: a.leaders.map(p => {
    const perf = performance.get(p.playerId);
    return { ...p, rank: perf ? displayRankFromProgress(canShowRankFromMmr(perf.hasFinishedMatch, perf.mmrManualOverride), perf.effectiveMmr, perf.prestigePoints) : "unranked" as const };
  }) })) };
}
export type HomeMatchStats = Awaited<ReturnType<typeof readHomeMatchStats>>;
