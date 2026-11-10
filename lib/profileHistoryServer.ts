import { supabaseServer } from "@/lib/supabaseServer";
import { buildProfileHistory, type MmrHistoryRow, type HistoryTournament, type HistoryMatch, type HistoryState } from "@/lib/profileHistory";
import { DEFAULT_PROFILE_PREFERENCES, type ProfilePreferences } from "@/lib/profilePreferences";

export async function readProfilePreferences(playerId: string): Promise<ProfilePreferences> {
  let { data, error } = await supabaseServer.from("players").select("chart_from,chart_to,rank_panel,stats_view").eq("id", playerId).maybeSingle();
  if (error && ["42703", "PGRST204"].includes(error.code)) {
    const fallback = await supabaseServer.from("players").select("chart_from,chart_to,rank_panel").eq("id", playerId).maybeSingle();
    data = fallback.data ? { ...fallback.data, stats_view: "last" } : null;
    error = fallback.error;
  }
  // Old deployments can still display profiles before the new migration is run.
  if (error && !["42703", "PGRST204"].includes(error.code)) throw new Error("profile_preferences_read_failed");
  return data ?? { ...DEFAULT_PROFILE_PREFERENCES };
}
export async function readProfileHistory(playerId: string, current?: HistoryState) {
  const rows: MmrHistoryRow[] = [];
  for (let offset = 0; ; offset += 500) {
    const { data, error } = await supabaseServer.from("player_mmr_history")
      .select("id,tournament_id,match_id,mmr,prestige_points,created_at,reason").eq("player_id", playerId)
      .order("created_at").order("id").range(offset, offset + 499);
    if (error) throw new Error("profile_history_read_failed");
    rows.push(...data);
    if (data.length < 500) break;
  }
  const ids = [...new Set(rows.flatMap(r => r.tournament_id ? [r.tournament_id] : []))];
  const tournaments: HistoryTournament[] = [];
  for (let offset = 0; offset < ids.length; offset += 100) {
    const { data, error } = await supabaseServer.from("tournaments")
      .select("id,name,event_at,started_at,created_at,name_day_number,is_private").in("id", ids.slice(offset, offset + 100));
    if (error) throw new Error("profile_history_tournaments_read_failed");
    tournaments.push(...data);
  }
  if (!rows.length) return [];
  const matchIds = [...new Set(rows.flatMap(r => r.match_id ? [r.match_id] : []))];
  const matches: HistoryMatch[] = [];
  for (let offset = 0; offset < matchIds.length; offset += 100) {
    const { data, error } = await supabaseServer.from("tournament_matches")
      .select("id,round_no,match_no").in("id", matchIds.slice(offset, offset + 100));
    if (error) throw new Error("profile_history_matches_read_failed");
    matches.push(...data);
  }
  const { data: baseline, error } = await supabaseServer.from("player_ranked_baselines")
    .select("baseline_mmr,baseline_prestige_points").eq("player_id", playerId).maybeSingle();
  if (error) throw new Error("profile_history_baseline_read_failed");
  return buildProfileHistory(rows, tournaments, { current, matches,
    baseline: baseline ? { mmr: Number(baseline.baseline_mmr), prestigePoints: Number(baseline.baseline_prestige_points) } : null });
}
