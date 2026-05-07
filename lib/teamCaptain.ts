export function pickTeamCaptainId(teamId: string, playerIds: string[]): string | null {
  const uniqueSorted = Array.from(new Set(playerIds.filter(Boolean))).sort();
  if (uniqueSorted.length <= 1) return null;

  // FNV-1a style hash for deterministic pseudo-random captain pick per team.
  let hash = 2166136261;
  for (const ch of teamId) {
    hash ^= ch.charCodeAt(0);
    hash = Math.imul(hash, 16777619);
  }

  const index = Math.abs(hash >>> 0) % uniqueSorted.length;
  return uniqueSorted[index] ?? null;
}

