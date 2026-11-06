import { parseNotebook, playerNotebookTotals, type NotebookPlayer } from "./notebook";

export const HITS_PER_REWARD = 3;
export const MAX_REWARDED_HITS_PER_GAME = 3;
export type HitRewardEntry = { player_id: string; tournament_id: string; match_id: string; game_no: number; credited_hits: number; points: number };
type Tournament = { id: string; mode: string; event_at: string | null; started_at: string | null; created_at: string; name_day_number: number | null };
type Match = { id: string; tournament_id: string; status: string; team_a_id: string | null; team_b_id: string | null;
  score_a: number; score_b: number; round_no: number; match_no: number; created_at: string };
type NotebookRow = { tournament_id: string; match_id: string; game_no: number; document: unknown; roster: NotebookPlayer[] };

/** Award once per three pooled hits, capped separately for every played BO game. */
export function buildHitRewards(tournaments: Tournament[], matches: Match[], notebooks: NotebookRow[]) {
  const ts = new Map(tournaments.filter(t => t.mode === "ranked").map(t => [t.id, t]));
  const ms = new Map(matches.filter(m => m.status === "finished" && m.team_a_id && m.team_b_id && ts.has(m.tournament_id)).map(m => [m.id, m]));
  const date = (t: Tournament) => t.event_at ?? t.started_at ?? t.created_at;
  const seen = new Set<string>();
  const eligible = notebooks.filter(n => {
    const m = ms.get(n.match_id);
    if (!m || m.tournament_id !== n.tournament_id || !Number.isInteger(n.game_no) || n.game_no < 1 || n.game_no > m.score_a + m.score_b) return false;
    const key = `${n.match_id}:${n.game_no}`;
    if (seen.has(key)) throw new Error("duplicate_hit_reward_notebook");
    seen.add(key);
    return true;
  }).sort((a, b) => {
    const ma = ms.get(a.match_id)!, mb = ms.get(b.match_id)!;
    const ta = ts.get(a.tournament_id)!, tb = ts.get(b.tournament_id)!;
    return Date.parse(date(ta)) - Date.parse(date(tb)) || (ta.name_day_number ?? 0) - (tb.name_day_number ?? 0)
      || ta.id.localeCompare(tb.id) || ma.round_no - mb.round_no || ma.match_no - mb.match_no
      || ma.created_at.localeCompare(mb.created_at) || ma.id.localeCompare(mb.id) || a.game_no - b.game_no;
  });
  const remainder = new Map<string, number>();
  const entries: HitRewardEntry[] = [];
  for (const n of eligible) {
    const m = ms.get(n.match_id)!;
    const doc = parseNotebook(n.document, n.roster);
    if (!doc || n.roster.some(p => p.teamId !== m.team_a_id && p.teamId !== m.team_b_id)) throw new Error("invalid_hit_reward_notebook");
    for (const p of n.roster) {
      // Center hits already include penalties. Opponent-can hits also count,
      // but all three kinds share the same per-game cap.
      const totals = playerNotebookTotals(doc, p.id);
      const credited = Math.min(MAX_REWARDED_HITS_PER_GAME, totals.hits + totals.opponentHits);
      if (!credited) continue;
      const pool = (remainder.get(p.id) ?? 0) + credited;
      const points = Math.floor(pool / HITS_PER_REWARD);
      remainder.set(p.id, pool % HITS_PER_REWARD);
      entries.push({ player_id: p.id, tournament_id: n.tournament_id, match_id: n.match_id, game_no: n.game_no, credited_hits: credited, points });
    }
  }
  return { entries, remainder };
}
