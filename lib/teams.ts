type PlayerWithStrength = {
  id: string;
  name: string;
  strength: number; 
};

function shuffle<T>(arr: T[]): T[] {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

function effectiveSum(sum: number, actualSize: number, targetSize: number) {
  if (actualSize <= 0) return 0;
  return sum * (targetSize / actualSize);
}

export function generateTeams(
  players: PlayerWithStrength[],
  teamSize: number,
  allowUneven: boolean,
  iterations: number
): { teams: PlayerWithStrength[][]; score: number } {
  const n = players.length;
  if (n === 0) return { teams: [], score: 0 };

  const teamCount = Math.ceil(n / teamSize);
  const minSize = allowUneven ? Math.floor(n / teamCount) : teamSize;
  const maxSize = allowUneven ? Math.ceil(n / teamCount) : teamSize;

  let bestTeams: PlayerWithStrength[][] = [];
  let bestScore = Number.POSITIVE_INFINITY;

  const iters = Math.max(1, Math.min(iterations, 5000));

  for (let iter = 0; iter < iters; iter++) {
    const shuffled = shuffle(players);

    const teams: PlayerWithStrength[][] = Array.from({ length: teamCount }, () => []);
    const sums = Array.from({ length: teamCount }, () => 0);

    for (const p of shuffled) {
      let bestIdx = 0;
      let bestVal = Number.POSITIVE_INFINITY;

      for (let i = 0; i < teamCount; i++) {
        const size = teams[i].length;

        if (size >= maxSize) continue;

        const eff = effectiveSum(sums[i], Math.max(1, size), teamSize);
        if (eff < bestVal) {
          bestVal = eff;
          bestIdx = i;
        }
      }

      teams[bestIdx].push(p);
      sums[bestIdx] += p.strength;
    }

    if (!allowUneven) {
      const ok = teams.every((t) => t.length === teamSize);
      if (!ok) continue;
    } else {
      const sizes = teams.map((t) => t.length);
      const min = Math.min(...sizes);
      const max = Math.max(...sizes);
      if (max - min > 1) continue;
      if (min < minSize || max > maxSize) continue;
    }

    const effSums = teams.map((t, i) =>
      effectiveSum(sums[i], Math.max(1, t.length), teamSize)
    );
    const spread = Math.max(...effSums) - Math.min(...effSums);

    const sizes = teams.map((t) => t.length);
    const sizeSpread = Math.max(...sizes) - Math.min(...sizes);
    const score = spread + sizeSpread * 0.25;

    if (score < bestScore) {
      bestScore = score;
      bestTeams = teams;
    }
  }

  return { teams: bestTeams, score: bestScore };
}