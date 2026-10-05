import { supabaseServer } from "@/lib/supabaseServer";
import { oracleLeagueFacts, type LeagueSnapshot } from "@/lib/oracleLeague";

// Shared across questions on this instance, never used by availability polling.
// Only explicitly listed public fields are selected; no auth data or profile settings.
let cached: { expires: number; snapshot: LeagueSnapshot } | null = null;
let pending: Promise<LeagueSnapshot> | null = null;
async function readRows<T>(table: string, columns: string, order: string[], cap: number): Promise<T[]> {
  const page = async (from: number) => {
    let query = supabaseServer.from(table).select(columns, { count: "exact" });
    for (const key of order) query = query.order(key);
    return query.range(from, from + 499).abortSignal(AbortSignal.timeout(5000));
  };
  const first = await page(0);
  if (first.error || first.count === null || first.count > cap || !first.data) throw new Error("context_unavailable");
  const rows = [...first.data];
  if (first.count > rows.length) {
    const results = await Promise.allSettled(Array.from({ length: Math.ceil(first.count / 500) - 1 }, (_, index) => page((index + 1) * 500)));
    for (const result of results) {
      if (result.status !== "fulfilled" || result.value.error || !result.value.data) throw new Error("context_unavailable");
      rows.push(...result.value.data);
    }
  }
  // Avoid returning misleading totals when the API truncated a page or the dataset changed.
  if (rows.length !== first.count) throw new Error("context_unavailable");
  return rows as T[];
}
async function readSnapshot(): Promise<LeagueSnapshot> {
  const queries = [
    readRows("players", "id,name,active,mmr,prestige_points,rating_override,mmr_manual_override,performance_bonus_until,ranked_win_streak,ranked_loss_streak", ["id"], 200),
    readRows("ratings", "rated_player_id,value", ["id"], 5000),
    readRows("team_members", "player_id,team_id", ["player_id", "team_id"], 2000),
    readRows("tournament_matches", "id,tournament_id,team_a_id,team_b_id,winner_team_id,status,created_at", ["id"], 2000),
    readRows("tournaments", "id,name,mode,started_at,created_at", ["id"], 500),
    readRows("tournament_results", "tournament_id,team_id,placement", ["tournament_id", "team_id"], 2000),
  ];
  const results = await Promise.allSettled(queries);
  if (results.some(result => result.status === "rejected")) throw new Error("context_unavailable");
  const [players, ratings, members, matches, tournaments, placements] = results.map(result => result.status === "fulfilled" ? result.value : []);
  return { players, ratings, members, matches, tournaments, results: placements } as LeagueSnapshot;
}
export async function readOracleLeagueFacts(question: string, askingPlayerId: string): Promise<string[]> {
  if (!cached || cached.expires <= Date.now()) {
    if (!pending) pending = readSnapshot().then(snapshot => {
      cached = { snapshot, expires: Date.now() + 60000 };
      return snapshot;
    }).finally(() => { pending = null; });
    await pending;
  }
  if (!cached) throw new Error("context_unavailable");
  return oracleLeagueFacts(cached.snapshot, question, askingPlayerId);
}
