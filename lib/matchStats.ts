import { notebookHits, parseNotebook, playerNotebookTotals, type NotebookPlayer } from "./notebook";

export const STAT_VIEWS = ["last", "recent", "all"] as const;
export type StatView = typeof STAT_VIEWS[number];
export const STAT_VIEW_LABELS: Record<StatView, string> = { last: "Ostatni mecz", recent: "Ostatnie 10 meczów", all: "Wszystkie mecze" };
export const isStatView = (v: unknown): v is StatView => STAT_VIEWS.includes(v as StatView);
export type StatsTournament = { id: string; name: string; mode: string; is_private: boolean | null; event_at: string | null; started_at: string | null; created_at: string; name_day_number: number | null; tournament_results: { placement: number }[] };
export type StatsMatch = { id: string; tournament_id: string; status: string; team_a_id: string | null; team_b_id: string | null; score_a: number; score_b: number; round_no: number; match_no: number; bracket: string; created_at: string };
export type StatsNotebook = { match_id: string; tournament_id: string; game_no: number; document: unknown; roster: NotebookPlayer[] };
export type StatsPlayer = { id: string; name: string; avatar_url: string | null };
export type StatsSnapshot = { tournaments: StatsTournament[]; matches: StatsMatch[]; notebooks: StatsNotebook[]; members: { player_id: string; team_id: string }[]; players: StatsPlayer[] };
export type GameStats = ReturnType<typeof playerNotebookTotals> & { playerId: string; matchId: string; game: number; finish: number | null; beer: string | null };
export type StatsSummary = {
  matches: number; expectedMatches: number; games: number; expectedGames: number;
  throws: number; hits: number; opponentHits: number; penaltyHits: number; cheats: number;
  accuracy: number | null; finishAverage: number | null; finishes: number;
  beers: { name: string; count: number }[];
};
export type PlayerStatsData = { views: Record<StatView, StatsSummary>; last: { name: string; href: string } | null };

export const statsDate = (t: StatsTournament) => t.event_at ?? t.started_at ?? t.created_at;
export function orderedStatsMatches(snapshot: StatsSnapshot) {
  const ts = new Map(snapshot.tournaments.map(t => [t.id, t]));
  return snapshot.matches.filter(m => m.status === "finished" && m.team_a_id && m.team_b_id && ts.get(m.tournament_id)?.mode === "ranked")
    .sort((a, b) => {
      const ta = ts.get(a.tournament_id)!, tb = ts.get(b.tournament_id)!;
      return Date.parse(statsDate(tb)) - Date.parse(statsDate(ta)) || (tb.name_day_number ?? 0) - (ta.name_day_number ?? 0)
        || b.round_no - a.round_no || b.match_no - a.match_no || b.created_at.localeCompare(a.created_at) || b.id.localeCompare(a.id);
    });
}
export function buildGameStats(snapshot: StatsSnapshot): GameStats[] {
  const matches = new Map(orderedStatsMatches(snapshot).map(m => [m.id, m]));
  return snapshot.notebooks.flatMap(row => {
    const m = matches.get(row.match_id);
    if (!m || m.tournament_id !== row.tournament_id || row.game_no < 1 || row.game_no > m.score_a + m.score_b) return [];
    const doc = parseNotebook(row.document, row.roster);
    if (!doc) throw new Error("invalid_stats_notebook");
    const hits = notebookHits(doc, row.roster);
    return row.roster.flatMap(p => {
      const totals = playerNotebookTotals(doc, p.id);
      const finish = hits.find(h => h.id === doc.players[p.id].finishedAt)?.number ?? null;
      const beer = doc.players[p.id].beer;
      // An untouched row is missing information, not a zero-performance game.
      if (!totals.throws && !totals.cheats && finish === null && beer === null) return [];
      return [{ ...totals, playerId: p.id, matchId: m.id, game: row.game_no, finish, beer }];
    });
  });
}
export function summarizeStats(games: GameStats[], matches: StatsMatch[]): StatsSummary {
  const ids = new Set(matches.map(m => m.id));
  const rows = games.filter(g => ids.has(g.matchId));
  const totals = rows.reduce((a, g) => ({ throws: a.throws + g.throws, hits: a.hits + g.hits, opponentHits: a.opponentHits + g.opponentHits,
    penaltyHits: a.penaltyHits + g.penaltyHits, cheats: a.cheats + g.cheats }), { throws: 0, hits: 0, opponentHits: 0, penaltyHits: 0, cheats: 0 });
  const finishes = rows.flatMap(g => g.finish === null ? [] : [g.finish]);
  const beers = new Map<string, number>();
  for (const g of rows) { const name = g.beer ?? "Nieznane"; beers.set(name, (beers.get(name) ?? 0) + 1); }
  return { ...totals, matches: new Set(rows.map(g => g.matchId)).size, expectedMatches: matches.length, games: rows.length,
    expectedGames: matches.reduce((n, m) => n + m.score_a + m.score_b, 0),
    accuracy: totals.throws ? totals.hits / totals.throws * 100 : null,
    finishAverage: finishes.length ? finishes.reduce((a, b) => a + b, 0) / finishes.length : null, finishes: finishes.length,
    beers: [...beers].map(([name, count]) => ({ name, count })).sort((a, b) => b.count - a.count || a.name.localeCompare(b.name, "pl")) };
}
export function playerStats(snapshot: StatsSnapshot, playerId: string, games = buildGameStats(snapshot)): PlayerStatsData {
  const teams = new Set(snapshot.members.filter(m => m.player_id === playerId).map(m => m.team_id));
  const ownGames = games.filter(g => g.playerId === playerId);
  const recorded = new Set(ownGames.map(g => g.matchId));
  const matches = orderedStatsMatches(snapshot).filter(m => recorded.has(m.id) || teams.has(m.team_a_id!) || teams.has(m.team_b_id!));
  const t = snapshot.tournaments.find(t => t.id === matches[0]?.tournament_id);
  return { views: { last: summarizeStats(ownGames, matches.slice(0, 1)), recent: summarizeStats(ownGames, matches.slice(0, 10)), all: summarizeStats(ownGames, matches) },
    // Never serialize a private match/tournament identifier, name, date or roster here.
    last: t && t.is_private !== true ? { name: t.name, href: `/tournaments/${t.id}/matches` } : null };
}

export type StatCategory = "accuracy" | "drinking" | "hits" | "opponent" | "cheats" | "penalty";
export const STAT_CATEGORIES: Record<StatCategory, string> = { accuracy: "Najcelniejsi", drinking: "Najszybsze picie", hits: "Najwięcej trafień", opponent: "Łowcy puszek", cheats: "Mistrzowie kombinowania", penalty: "Karne w punkt" };
export type StatsLeader = { playerId: string; name: string; avatarUrl: string | null; summary: StatsSummary };
export type StatsAward = { category: StatCategory; value: number; leaders: StatsLeader[] };
export function statsAwards(snapshot: StatsSnapshot, matches: StatsMatch[], games = buildGameStats(snapshot)): StatsAward[] {
  const candidates = snapshot.players.map(p => ({ playerId: p.id, name: p.name, avatarUrl: p.avatar_url,
    summary: summarizeStats(games.filter(g => g.playerId === p.id), matches.filter(m => games.some(g => g.playerId === p.id && g.matchId === m.id))) }));
  return (Object.keys(STAT_CATEGORIES) as StatCategory[]).flatMap(category => {
    const score = (s: StatsSummary): number | null => category === "accuracy" ? (s.throws >= 5 ? s.accuracy : null)
      : category === "drinking" ? s.finishAverage : category === "hits" ? s.hits : category === "opponent" ? s.opponentHits : category === "cheats" ? s.cheats : s.penaltyHits;
    const eligible = candidates.filter(p => { const n = score(p.summary); return n !== null && (category === "accuracy" || n > 0); });
    if (!eligible.length) return [];
    const value = (category === "drinking" ? Math.min : Math.max)(...eligible.map(p => score(p.summary)!));
    return [{ category, value, leaders: eligible.filter(p => Math.abs(score(p.summary)! - value) < 1e-9).sort((a, b) => a.name.localeCompare(b.name, "pl")) }];
  });
}
export function recentStatsAwards(snapshot: StatsSnapshot) {
  const tournaments = snapshot.tournaments.filter(t => t.mode === "ranked" && t.tournament_results.some(r => r.placement === 1))
    .sort((a, b) => Date.parse(statsDate(b)) - Date.parse(statsDate(a)) || (b.name_day_number ?? 0) - (a.name_day_number ?? 0) || b.id.localeCompare(a.id)).slice(0, 10);
  const ids = new Set(tournaments.map(t => t.id));
  return { count: tournaments.length, awards: statsAwards(snapshot, orderedStatsMatches(snapshot).filter(m => ids.has(m.tournament_id))) };
}
