type MatchTeams = {
  team_a_id: string | null;
  team_b_id: string | null;
  status: string;
};

export function computeBeersFromFinishedMatches(
  matches: MatchTeams[],
  teamSizeMap: Map<string, number>
): number {
  return matches.reduce((sum, m) => {
    if (m.status !== "finished") return sum;
    if (!m.team_a_id || !m.team_b_id) return sum;
    const aSize = teamSizeMap.get(m.team_a_id) ?? 0;
    const bSize = teamSizeMap.get(m.team_b_id) ?? 0;
    return sum + aSize + bSize;
  }, 0);
}
