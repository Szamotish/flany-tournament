import { buildGameStats, orderedStatsMatches, statsAwards, summarizeStats, type StatsSnapshot } from "./matchStats";

export function tournamentStats(snapshot: StatsSnapshot, tournamentId: string) {
  const matches = orderedStatsMatches(snapshot).filter(m => m.tournament_id === tournamentId);
  const ids = new Set(matches.map(m => m.id));
  const games = buildGameStats(snapshot).filter(g => ids.has(g.matchId));
  const players = new Map(snapshot.players.map(p => [p.id, p]));
  return { awards: statsAwards(snapshot, matches, games), matches: matches.slice().reverse().map(match => {
    const recorded = games.filter(g => g.matchId === match.id);
    const roster = new Map(snapshot.notebooks.filter(n => n.match_id === match.id).flatMap(n => n.roster).map(p => [p.id, p]));
    const bracket = match.bracket === "winners" ? "Winners · " : match.bracket === "losers" ? "Losers · " : match.bracket === "grand_final" ? "Finał · " : "";
    return { id: match.id, label: `${bracket}R${match.round_no} · Mecz ${match.match_no}`, expectedGames: match.score_a + match.score_b,
      players: [...roster.values()].sort((a, b) => (players.get(a.id)?.name ?? a.name).localeCompare(players.get(b.id)?.name ?? b.name, "pl")).map(p => ({ playerId: p.id, name: players.get(p.id)?.name ?? p.name,
        summary: summarizeStats(recorded.filter(g => g.playerId === p.id), [match]),
        games: recorded.filter(g => g.playerId === p.id).sort((a, b) => a.game - b.game).map(({ game, throws: attempts, hits, opponentHits, penaltyHits, cheats, finish, beer }) =>
          ({ game, throws: attempts, hits, opponentHits, penaltyHits, cheats, finish, beer })) })),
    };
  }) };
}
export type TournamentStatsData = ReturnType<typeof tournamentStats>;
