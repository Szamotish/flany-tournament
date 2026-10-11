import type { DisplayRank } from "@/lib/playerRank";

export type PerformanceTournament = {
  id: string; name: string; mode: string; format: string | null; event_at: string | null;
  started_at: string | null; created_at: string; is_private: boolean | null; name_day_number: number | null;
};
export type PerformanceResult = { tournament_id: string; team_id: string; placement: number };
export type PerformanceMatch = { tournament_id: string; team_a_id: string | null; team_b_id: string | null; status: string };
export type PerformanceMember = { team_id: string; player_id: string };
export type PerformanceOutcome = "win" | "loss" | "absent";
export type PerformanceScore = { playerId: string; wins: number; played: number; outcomes: PerformanceOutcome[] };
export type PerformanceMarker = { name: string; href: string | null; playedAt: string; format: string | null };
export type BestPerformer = PerformanceScore & { name: string; avatarUrl: string | null; rank: DisplayRank };
export type BestPerformanceData = { tournaments: PerformanceMarker[]; leaders: BestPerformer[] };

export function performanceTournamentDate(t: PerformanceTournament) {
  return [t.event_at, t.started_at, t.created_at].find(value => value && Number.isFinite(Date.parse(value))) ?? t.created_at;
}
export function selectPerformanceWindow(tournaments: PerformanceTournament[], results: PerformanceResult[]) {
  const completed = new Set(results.filter(r => r.placement === 1).map(r => r.tournament_id));
  return [...new Map(tournaments.map(t => [t.id, t])).values()]
    .filter(t => t.mode === "ranked" && completed.has(t.id))
    .sort((a, b) => Date.parse(performanceTournamentDate(b)) - Date.parse(performanceTournamentDate(a))
      || (b.name_day_number ?? 0) - (a.name_day_number ?? 0)
      || Date.parse(b.created_at) - Date.parse(a.created_at) || b.id.localeCompare(a.id))
    .slice(0, 10).reverse();
}
export function scoreBestPerformance(window: PerformanceTournament[], results: PerformanceResult[], matches: PerformanceMatch[], members: PerformanceMember[]): PerformanceScore[] {
  const scores = new Map<string, PerformanceScore>();
  const playersByTeam = new Map<string, Set<string>>();
  for (const member of members) {
    if (!playersByTeam.has(member.team_id)) playersByTeam.set(member.team_id, new Set());
    playersByTeam.get(member.team_id)!.add(member.player_id);
  }
  window.forEach((t, index) => {
    const winners = new Set(results.filter(r => r.tournament_id === t.id && r.placement === 1)
      .flatMap(r => [...playersByTeam.get(r.team_id) ?? []]));
    // Registration alone is not a played tournament. Include eliminated teams,
    // which may never have a podium row, but exclude empty/BYE matches.
    const participants = new Set(matches.filter(m => m.tournament_id === t.id && m.status === "finished" && m.team_a_id && m.team_b_id)
      .flatMap(m => [...playersByTeam.get(m.team_a_id!) ?? [], ...playersByTeam.get(m.team_b_id!) ?? []]));
    winners.forEach(id => participants.add(id));
    for (const id of participants) {
      const score = scores.get(id) ?? { playerId: id, wins: 0, played: 0, outcomes: Array<PerformanceOutcome>(window.length).fill("absent") };
      score.played++;
      score.outcomes[index] = winners.has(id) ? "win" : "loss";
      if (winners.has(id)) score.wins++;
      scores.set(id, score);
    }
  });
  const maximum = Math.max(0, ...[...scores.values()].map(s => s.wins));
  return maximum > 0 ? [...scores.values()].filter(s => s.wins === maximum) : [];
}

// Only this sanitized representation may cross the server/client boundary.
export function performanceMarkers(window: PerformanceTournament[]): PerformanceMarker[] {
  return window.map(t => ({
    name: t.is_private ? "Turniej prywatny" : t.name,
    href: t.is_private ? null : `/tournaments/${t.id}`,
    playedAt: performanceTournamentDate(t), format: t.is_private ? null : t.format,
  }));
}
